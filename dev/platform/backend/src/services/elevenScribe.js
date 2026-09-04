// Speech-to-text with speaker separation (diarisation) via ElevenLabs Scribe.
// Whisper (the recorder's transcriber) can't tell speakers apart; Scribe returns
// word-level timings tagged with a speaker id, which we group into turns. Reuses
// the ELEVENLABS_API_KEY already configured for voiceovers — no new provider.
//
// Docs: https://elevenlabs.io/docs/api-reference/speech-to-text
// Fire from the upload route in the background: transcription of a long file can
// take a minute or two, so the request returns immediately and the UI polls.

const pool = require('../db');
const mediaStore = require('./mediaStore');
const { getSetting } = require('../utils/settings');

const BASE_URL = 'https://api.elevenlabs.io/v1';
const MODEL_ID = 'scribe_v1';

// Turn ElevenLabs' flat word list into ordered speaker turns. Each word carries
// { text, type: 'word'|'spacing'|'audio_event', speaker_id }. We stitch a run of
// consecutive words from the same speaker into one turn, so the transcript reads
// as a conversation rather than a wall of tokens.
function wordsToSegments(words) {
  const segs = [];
  let cur = null;
  for (const w of words || []) {
    if (w.type && w.type !== 'word' && w.type !== 'spacing') continue; // skip audio_event etc.
    const speaker = w.speaker_id || 'speaker_0';
    if (w.type === 'spacing') { if (cur) cur.text += w.text || ' '; continue; }
    if (!cur || cur.speaker !== speaker) {
      if (cur) segs.push(cur);
      cur = { speaker, start: w.start ?? null, end: w.end ?? null, text: w.text || '' };
    } else {
      cur.text += w.text || '';
      if (w.end != null) cur.end = w.end;
    }
  }
  if (cur) segs.push(cur);
  // Tidy whitespace on each turn.
  return segs.map((s) => ({ ...s, text: s.text.replace(/\s+/g, ' ').trim() })).filter((s) => s.text);
}

// Distinct speaker ids in first-appearance order, e.g. ['speaker_0','speaker_1'].
function speakersFrom(segments) {
  const seen = [];
  for (const s of segments) if (!seen.includes(s.speaker)) seen.push(s.speaker);
  return seen;
}

// Call Scribe with a buffer. Returns { language, segments, speakers } or throws.
async function transcribeBuffer(buf, mime, filename) {
  const key = await getSetting('ELEVENLABS_API_KEY');
  if (!key) throw new Error('ELEVENLABS_API_KEY not set in Settings — add it to enable transcription.');

  const fd = new FormData();
  fd.append('file', new Blob([buf], { type: mime || 'audio/mpeg' }), filename || 'audio');
  fd.append('model_id', MODEL_ID);
  fd.append('diarize', 'true');            // speaker separation
  fd.append('timestamps_granularity', 'word');

  const res = await fetch(`${BASE_URL}/speech-to-text`, {
    method: 'POST',
    headers: { 'xi-api-key': key },
    body: fd,
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 300);
    throw new Error(`ElevenLabs Scribe ${res.status}: ${detail || 'request failed'}`);
  }
  const data = await res.json();
  const segments = wordsToSegments(data.words);
  // If diarisation returned nothing usable, fall back to a single-speaker turn
  // from the plain text so the user still gets a transcript.
  if (!segments.length && data.text) {
    segments.push({ speaker: 'speaker_0', start: null, end: null, text: String(data.text).trim() });
  }
  return { language: data.language_code || null, segments, speakers: speakersFrom(segments) };
}

// Transcribe one stored transcript row and persist the result. Safe to call
// fire-and-forget from a request handler.
async function processTranscript(id) {
  try {
    const { rows } = await pool.query('SELECT storage_key, mime, status FROM transcripts WHERE id = $1', [id]);
    const row = rows[0];
    if (!row || !row.storage_key || row.status === 'ready') return;
    const buf = await mediaStore.getBuffer(row.storage_key);
    const { language, segments } = await transcribeBuffer(buf, row.mime, `audio-${id}`);
    await pool.query(
      `UPDATE transcripts SET status = 'ready', language = $2, segments = $3::jsonb, error = NULL WHERE id = $1`,
      [id, language, JSON.stringify(segments)]
    );
  } catch (err) {
    console.warn('[elevenScribe] transcript failed for', id, err.message);
    await pool.query(`UPDATE transcripts SET status = 'error', error = $2 WHERE id = $1`, [id, err.message.slice(0, 500)]).catch(() => {});
  }
}

function processInBackground(id) {
  processTranscript(id).catch(() => {});
}

module.exports = { transcribeBuffer, processTranscript, processInBackground, wordsToSegments, speakersFrom };
