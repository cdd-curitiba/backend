const axios = require('axios');

const api = axios.create({
  baseURL: process.env.EVOLUTION_API_URL,
  headers: {
    apikey: process.env.EVOLUTION_API_KEY,
    'Content-Type': 'application/json',
  },
});

const INSTANCE = process.env.EVOLUTION_INSTANCE;

async function sendText(phone, text) {
  await api.post(`/message/sendText/${INSTANCE}`, {
    number: phone,
    text,
  });
}

async function downloadMedia(messageId, messageType) {
  const response = await api.post(`/chat/getBase64FromMediaMessage/${INSTANCE}`, {
    message: { key: { id: messageId } },
    convertToMp4: false,
  });
  return Buffer.from(response.data.base64, 'base64');
}

module.exports = { sendText, downloadMedia };
