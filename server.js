const express = require('express');
const { pool } = require('./db');

const app = express();
app.use(express.json());

// Allow the Flutter web app (a different origin) to call this API.
// Token-based auth (no cookies), so a permissive origin is fine for now.
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Basic liveness — does not touch the database
app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'bsc-portal-backend', time: new Date().toISOString() });
});

// Database connectivity check
app.get('/health/db', async (req, res) => {
  try {
    const r = await pool.query('SELECT now() AS now');
    res.json({ ok: true, db_time: r.rows[0].now });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// --- Routes ---
app.use('/auth', require('./routes/auth'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`BSC Portal backend listening on :${PORT}`));
