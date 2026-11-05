// Help chatbot API. Works for everyone; if a valid login token is sent,
// answers can include the user's own complaints (citizen) or department counts (admin).
const express = require('express');
const jwt = require('jsonwebtoken');
const chatbot = require('../ai/chatbot');
const { langOf } = require('../i18n');

const router = express.Router();

function optionalUser(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return null;
  try { return jwt.verify(header.slice(7), process.env.JWT_SECRET); } catch { return null; }
}

// Simple per-IP rate limit: 30 messages per minute.
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((tm) => now - tm < 60000);
  list.push(now);
  hits.set(ip, list);
  return list.length > 30;
}

router.get('/welcome', (req, res) => {
  res.json(chatbot.welcome(optionalUser(req), langOf(req)));
});

router.post('/', async (req, res) => {
  if (rateLimited(req.ip)) return res.status(429).json({ error: 'Too many messages, please wait a minute.' });
  try {
    const { message, history } = req.body || {};
    const result = await chatbot.answer({
      message,
      lang: langOf(req),
      user: optionalUser(req),
      history: Array.isArray(history) ? history : [],
    });
    res.json(result);
  } catch (err) {
    console.error('[chat]', err);
    res.status(500).json({ error: 'Chat failed' });
  }
});

module.exports = router;
