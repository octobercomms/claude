// ElevenLabs — text-to-speech voiceover. Pay-per-character (~$0.30 per
// minute of generated audio at "creator" tier). Used to render the
// voiceover script inside a post's storyboard without recording it
// manually.
//
// We store the resulting MP3 on local disk under <backend>/uploads/
// audio/<post_id>/<id>.mp3 and serve it back through the brandAssets
// /file route to keep auth + visibility consistent.

const axios = require('axios');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { getSetting } = require('../utils/settings');

const BASE_URL = 'https://api.elevenlabs.io/v1';
const DEFAULT_VOICE_ID = 'EXAVITQu4vr4xnSDxMaL';    // Bella — neutral female
const UPLOAD_ROOT = path.join(__dirname, '../../uploads');

async function getKey() {
  const key = await getSetting('ELEVENLABS_API_KEY');
  if (!key) throw new Error('ELEVENLABS_API_KEY not set in Settings');
  return key;
}

// Render a single voiceover. Returns { url, duration_sec_estimate }.
// We don't compute exact duration (would need ffprobe) — the metadata
// estimate is good enough for the UI badge.
async function generateVoiceover({ text, voice_id, client_id }) {
  if (!text || !text.trim()) throw new Error('text is required');
  if (!client_id) throw new Error('client_id required for audio storage');
  const key = await getKey();
  const voice = voice_id || DEFAULT_VOICE_ID;

  const { data } = await axios.post(
    `${BASE_URL}/text-to-speech/${voice}`,
    {
      text,
      model_id: 'eleven_multilingual_v2',
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    },
    {
      headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
      responseType: 'arraybuffer',
    }
  );

  const dir = path.join(UPLOAD_ROOT, client_id);
  fs.mkdirSync(dir, { recursive: true });
  const filename = `vo-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.mp3`;
  fs.writeFileSync(path.join(dir, filename), Buffer.from(data));

  // ~150 words/min ≈ ~880 chars/min — rough estimate good enough for a UI hint.
  const duration_sec = Math.round((text.length / 880) * 60);

  return {
    url: `/api/brand/file/${client_id}/${filename}`,
    duration_sec,
    voice_id: voice,
  };
}

async function listVoices() {
  try {
    const key = await getKey();
    const { data } = await axios.get(`${BASE_URL}/voices`, { headers: { 'xi-api-key': key } });
    return (data.voices || []).map(v => ({ value: v.voice_id, label: v.name, accent: v.labels?.accent, gender: v.labels?.gender }));
  } catch {
    return [];
  }
}

async function testCredentials() {
  try {
    const key = await getKey();
    const { data } = await axios.get(`${BASE_URL}/user/subscription`, { headers: { 'xi-api-key': key } });
    return { ok: true, message: `Connected — ${(data.character_limit - data.character_count).toLocaleString()} characters left this period.` };
  } catch (err) {
    return { ok: false, message: err.response?.data?.detail?.message || err.message };
  }
}

module.exports = { generateVoiceover, listVoices, testCredentials, AUDIO_ROOT };
