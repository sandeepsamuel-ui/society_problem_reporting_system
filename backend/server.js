const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Load backend/.env (GEMINI_API_KEY, JWT_SECRET, PORT ...)
const ENV_FILE = path.join(__dirname, '.env');
if (fs.existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);
if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
  fs.appendFileSync(ENV_FILE, `\nJWT_SECRET=${process.env.JWT_SECRET}\n`);
}

const express = require('express');
const { activeProvider } = require('./ai/llm');
const localVision = require('./ai/localVision');
const db = require('../db/database');

const app = express();
const PORT = Number(process.env.PORT || 5000);
const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');

// Allow the pages to be served by VS Code Live Server (e.g. http://127.0.0.1:5500) or any other
// local port, while the API runs here. Only local addresses are allowed.
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && (LOCAL_ORIGIN.test(origin) || origin === 'null')) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Lang');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
  }
  next();
});

app.use(express.json({ limit: '1mb' }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// When this server hosts the pages itself, they call the API on the same address.
app.get('/js/config.js', (req, res) => {
  res.type('application/javascript').send("window.CIVICPULSE_API = '';\n");
});

app.get('/api/health', (req, res) => res.json({
  ok: true,
  cloudAI: activeProvider()?.label || null,
  localAI: localVision.MODEL_ID,
  database: path.basename(db.FILE),
}));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/citizen', require('./routes/citizen'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/chat', require('./routes/chat'));

app.use(express.static(FRONTEND_DIR));
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Server error' });
});

const server = app.listen(PORT, () => {
  console.log(`CivicPulse running at http://localhost:${PORT}`);
  console.log(`Database: ${db.FILE}`);
  const cloud = activeProvider();
  console.log(cloud
    ? `Cloud AI: ${cloud.label} (local CLIP model used for image fingerprints and as backup)`
    : 'Cloud AI: none. Using the local CLIP model. Add GEMINI_API_KEY to backend/.env for better descriptions.');
  // Load the local model now so the first photo is fast (first run downloads ~150 MB).
  localVision.load().catch((err) => console.warn('[local-ai] could not load model:', err.message));
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n❌ Port ${PORT} is already in use. CivicPulse may already be running in another terminal.`);
    console.error('   Fix: stop the other one (Ctrl+C in that terminal), or add PORT=5001 to backend/.env');
    console.error('   (and change the port in frontend/js/config.js if you use Live Server).\n');
    process.exit(1);
  }
  throw err;
});
