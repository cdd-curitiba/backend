const axios = require('axios');
const FormData = require('form-data');

async function transcribeAudio(audioBuffer, mimeType = 'audio/ogg') {
  const form = new FormData();
  form.append('file', audioBuffer, {
    filename: 'audio.ogg',
    contentType: mimeType,
  });
  form.append('model', 'whisper-1');
  form.append('language', 'pt');

  const response = await axios.post(
    'https://api.openai.com/v1/audio/transcriptions',
    form,
    {
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        ...form.getHeaders(),
      },
    }
  );

  return response.data.text;
}

module.exports = { transcribeAudio };
