const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// Fixed approver list (by emp_code), resolved to live employee ids.
const APPROVERS = [
  { emp_code: 'BSC/006', label: 'Bakthavachalam' },
  { emp_code: 'BSC/098', label: 'Kannan' },
  { emp_code: 'CMD',     label: 'Goverdhan' },
  { emp_code: 'CEO',     label: 'Gourav' },
  { emp_code: 'BSC/125', label: 'HR (Aiswarya)' },
];

router.get('/approvers', async (req, res) => {
  const codes = APPROVERS.map(a => a.emp_code);
  const rows = (await pool.query(
    `SELECT id, emp_code, name FROM employees WHERE emp_code = ANY($1) AND active = true`, [codes])).rows;
  const byCode = Object.fromEntries(rows.map(r => [r.emp_code, r]));
  const list = APPROVERS
    .filter(a => byCode[a.emp_code])
    .map(a => ({ employee_id: byCode[a.emp_code].id, label: a.label }));
  res.json({ ok: true, approvers: list });
});

async function nextRef() {
  const n = (await pool.query(`SELECT COUNT(*)::int AS c FROM outpass_requests`)).rows[0].c + 1;
  const d = new Date();
  const yy = String(d.getFullYear()).slice(2);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `OGP/BSC/${yy}${mm}${dd}/${String(n).padStart(4, '0')}`;
}

const SELECT_REQ = `
  SELECT o.*, to_char(o.entry_date,'DD Mon YYYY') AS entry_date_display,
         e.name AS employee_name, e.emp_code AS employee_code, e.job_title AS designation,
         a.name AS approver_name
  FROM outpass_requests o
  JOIN employees e ON e.id = o.employee_id
  JOIN employees a ON a.id = o.approver_id`;

// Submit a request
router.post('/', async (req, res) => {
  const { type, on_duty, entry_date, purpose, out_time, in_time, approver_id } = req.body || {};
  if (!['outpass', 'gatepass'].includes(type)) {
    return res.status(400).json({ ok: false, error: 'Choose Outpass or Gatepass' });
  }
  if (!entry_date || !purpose || !out_time || !approver_id) {
    return res.status(400).json({ ok: false, error: 'Date, purpose, out-time and approver are required' });
  }
  if (type === 'gatepass' && !in_time) {
    return res.status(400).json({ ok: false, error: 'In-time is required for a Gatepass' });
  }
  const appr = (await pool.query(`SELECT id FROM employees WHERE id=$1 AND active=true`, [approver_id])).rows[0];
  if (!appr) return res.status(400).json({ ok: false, error: 'Invalid approver' });
  const ref = await nextRef();
  const r = await pool.query(
    `INSERT INTO outpass_requests
       (ref, employee_id, type, on_duty, entry_date, purpose, out_time, in_time, approver_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [ref, req.user.id, type, on_duty === true, entry_date, purpose.trim(), out_time,
     type === 'gatepass' ? in_time : null, approver_id]);
  res.json({ ok: true, id: r.rows[0].id, ref });
});

// My own requests
router.get('/mine', async (req, res) => {
  const rows = (await pool.query(
    `${SELECT_REQ} WHERE o.employee_id=$1 ORDER BY o.created_at DESC`, [req.user.id])).rows;
  res.json({ ok: true, requests: rows });
});

// Requests awaiting my approval
router.get('/pending', async (req, res) => {
  const rows = (await pool.query(
    `${SELECT_REQ} WHERE o.approver_id=$1 AND o.status='pending' ORDER BY o.created_at ASC`,
    [req.user.id])).rows;
  res.json({ ok: true, requests: rows });
});

router.get('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const row = (await pool.query(`${SELECT_REQ} WHERE o.id=$1`, [id])).rows[0];
  if (!row) return res.status(404).json({ ok: false, error: 'Not found' });
  if (row.employee_id !== req.user.id && row.approver_id !== req.user.id) {
    return res.status(403).json({ ok: false, error: 'Not allowed' });
  }
  res.json({ ok: true, request: row });
});

router.post('/:id/approve', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const row = (await pool.query(`SELECT * FROM outpass_requests WHERE id=$1`, [id])).rows[0];
  if (!row) return res.status(404).json({ ok: false, error: 'Not found' });
  if (row.approver_id !== req.user.id) {
    return res.status(403).json({ ok: false, error: 'Only the assigned approver can act' });
  }
  if (row.status !== 'pending') return res.status(400).json({ ok: false, error: 'Already ' + row.status });
  await pool.query(`UPDATE outpass_requests SET status='approved', decided_at=now() WHERE id=$1`, [id]);
  // PDF generation, OneDrive upload and WhatsApp come in later sub-bricks.
  res.json({ ok: true });
});

router.post('/:id/reject', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const reason = (req.body && req.body.reason) || '';
  const row = (await pool.query(`SELECT * FROM outpass_requests WHERE id=$1`, [id])).rows[0];
  if (!row) return res.status(404).json({ ok: false, error: 'Not found' });
  if (row.approver_id !== req.user.id) {
    return res.status(403).json({ ok: false, error: 'Only the assigned approver can act' });
  }
  if (row.status !== 'pending') return res.status(400).json({ ok: false, error: 'Already ' + row.status });
  await pool.query(
    `UPDATE outpass_requests SET status='rejected', reject_reason=$1, decided_at=now() WHERE id=$2`,
    [reason, id]);
  res.json({ ok: true });
});

module.exports = router;
