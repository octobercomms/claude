// Transcription via the OpenAI Whisper API (verbose_json → timestamped
// segments) for the caption stage. Only used when OPENAI_API_KEY is set;
// otherwise the caption stage skips and the pipeline still produces a cut.

const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');
const { config } = require('./config');

async function transcribe(wavPath) {
  const form = new FormData();
  form.append('file', fs.createReadStream(wavPath));
  form.append('model', config.whisperModel);
  form.append('response_format', 'verbose_json');
  const { data } = await axios.post('https://api.openai.com/v1/audio/transcriptions', form, {
    headers: { ...form.getHeaders(), Authorization: `Bearer ${config.openaiKey}` },
    timeout: 180000,
    maxBodyLength: Infinity,
  });
  return data; // { text, segments: [{ start, end, text }] }
}

module.exports = { transcribe };
