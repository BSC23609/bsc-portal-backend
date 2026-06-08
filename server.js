const express = require('express');
const { pool } = require('./db');

const app = express();
app.use(express.json());

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
