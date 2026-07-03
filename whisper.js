const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Transcreve áudio usando o Gemini (multimodal) em vez da API paga da OpenAI
// (Whisper). Usa a mesma GEMINI_API_KEY que já está configurada pro resto
// do bot, então não precisa de crédito/conta separada.
async function transcribeAudio(audioBuffer, mimeType = 'audio/ogg') {
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

  const base64 = audioBuffer.toString('base64');

  const result = await model.generateContent([
    { text: 'Transcreva o áudio a seguir literalmente, em português. Responda APENAS com o texto transcrito, sem comentários, sem aspas, sem formatação adicional.' },
    { inlineData: { mimeType, data: base64 } },
  ]);

  return result.response.text().trim();
}

module.exports = { transcribeAudio };
