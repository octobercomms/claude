// AI-powered audio cleanup via ElevenLabs Audio Isolation.
// Strips echo, background noise and room reverb from speech while keeping it
// natural. Reuses the ELEVENLABS_API_KEY already configured for voiceovers
// and Scribe. Docs: https://elevenlabs.io/docs/api-reference/audio-isolation
//
// The endpoint accepts an audio file and returns the cleaned version as a
// stream. We store both original and cleaned files through mediaStore so they
// survive restarts and can move to R2 later.

const pool = require('../db');
const mediaStore = require('./mediaStore');
const { getSetting } = require('../utils/settings');
const audioMaster = require('./audioMaster');

const BASE_URL = 'https://api.elevenlabs.io/v1';

async function processCleanup(id) {
  try {
    const { rows } = await pool.query(
      'SELECT storage_key, mime, status FROM audio_cleanups WHERE id = $1', [id]
    );
    const row = rows[0];
    if (!row || !row.storage_key || row.status === 'ready') return;

    const key = await getSetting('ELEVENLABS_API_KEY');
    if (!key) throw new Error('ELEVENLABS_API_KEY not set in Settings.');

    const buf = await mediaStore.getBuffer(row.storage_key);

    const fd = new FormData();
    fd.append('audio', new Blob([buf], { type: row.mime || 'audio/mpeg' }), `audio-${id}`);

    const res = await fetch(`${BASE_URL}/audio-isolation`, {
      method: 'POST',
      headers: { 'xi-api-key': key },
      body: fd,
    });

    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 300);
      throw new Error(`ElevenLabs Audio Isolation ${res.status}: ${detail || 'request failed'}`);
    }

    const isolatedBuf = Buffer.from(await res.arrayBuffer());

    // Second stage: level it and shape the voice. Isolation removes what
    // should not be there; this fixes what is. See services/audioMaster.js.
    //
    // Deliberately non-fatal. A clean but quiet file is worth delivering, so a
    // mastering failure falls back to the isolated audio and records why,
    // rather than turning a working cleanup into an error the operator has to
    // interpret. `mastering` stays null in that case, which is what the screen
    // reads to decide whether it can quote a loudness figure.
    let finalBuf = isolatedBuf;
    let mastering = null;
    try {
      const mastered = await audioMaster.master(isolatedBuf, { ext: 'mp3' });
      finalBuf = mastered.buffer;
      mastering = mastered.mastering;
    } catch (err) {
      console.warn('[audioIsolation] mastering failed for', id, err.message);
      mastering = { skipped: true, reason: err.message.slice(0, 300) };
    }

    const cleanedKey = row.storage_key.replace(/(\.[a-z0-9]+)$/i, '-cleaned$1');
    await mediaStore.saveBuffer(cleanedKey, finalBuf, 'audio/mpeg');

    await pool.query(
      `UPDATE audio_cleanups
         SET status = 'ready', cleaned_key = $2, cleaned_size = $3,
             mastering = $4::jsonb, error = NULL
       WHERE id = $1`,
      [id, cleanedKey, finalBuf.length, JSON.stringify(mastering)]
    );
  } catch (err) {
    console.warn('[audioIsolation] cleanup failed for', id, err.message);
    await pool.query(
      `UPDATE audio_cleanups SET status = 'error', error = $2 WHERE id = $1`,
      [id, err.message.slice(0, 500)]
    ).catch(() => {});
  }
}

function processInBackground(id) {
  processCleanup(id).catch(() => {});
}

module.exports = { processCleanup, processInBackground };
