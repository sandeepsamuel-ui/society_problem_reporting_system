// Cloud AI: Google Gemini (optional). Free key: https://aistudio.google.com/apikey
// If GEMINI_API_KEY is not set, the app uses the local CLIP model in localVision.js instead.
const { GoogleGenAI } = require('@google/genai');

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const gemini = process.env.GEMINI_API_KEY ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }) : null;

function activeProvider() {
  return gemini ? { name: 'gemini', label: `Google Gemini (${GEMINI_MODEL})` } : null;
}

function toParts(parts) {
  return parts.map((p) => (p.image ? { inlineData: { mimeType: p.image.mediaType, data: p.image.base64 } } : { text: p.text }));
}

/**
 * parts: array of { text } or { image: { base64, mediaType } }
 * Returns the parsed JSON object that matches `schema`.
 */
async function askVisionJSON({ system, parts, schema }) {
  if (!gemini) throw new Error('GEMINI_API_KEY is not set');
  const { additionalProperties, ...jsonSchema } = schema;
  const response = await gemini.models.generateContent({
    model: GEMINI_MODEL,
    contents: [{ role: 'user', parts: toParts(parts) }],
    config: {
      systemInstruction: system,
      responseMimeType: 'application/json',
      responseJsonSchema: jsonSchema,
      temperature: 0.2,
    },
  });
  return JSON.parse(response.text);
}

/** Plain-text chat answer (used by the help chatbot). history: [{ role: 'user'|'bot', text }] */
async function chat({ system, history }) {
  if (!gemini) throw new Error('GEMINI_API_KEY is not set');
  const response = await gemini.models.generateContent({
    model: GEMINI_MODEL,
    contents: history.map((m) => ({ role: m.role === 'bot' ? 'model' : 'user', parts: [{ text: m.text }] })),
    config: { systemInstruction: system, temperature: 0.3, maxOutputTokens: 600 },
  });
  return (response.text || '').trim();
}

module.exports = { askVisionJSON, chat, activeProvider, GEMINI_MODEL };
