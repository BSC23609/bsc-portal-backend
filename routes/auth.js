const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../db');
const { signToken, requireAuth } = require('../middleware/auth');

const router = express.Router();
const DEFAULT_PASSWORD = 'Bsc@123';

// Resolve which apps an employee may open — the access logic from the data model.
async function appsFor(emp) {
  let rows;
  if (emp.role === 'super_admin') {
    rows = (await pool.query(
      `SELECT * FROM apps WHERE active=true ORDER BY launcher_group, sort_order, name`
    )).rows;
  } else if (emp.role === 'company_admin') {
    rows = (await pool.query(
      `SELECT * FROM apps WHERE active=true AND company_id=$1 ORDER BY launcher_group, sort_order, name`,
      [emp.company_id]
    )).rows;
  } else {
    rows = (await pool.query(
      `SELECT DISTINCT a.* FROM apps a
       WHERE a.active=true AND a.company_id=$1 AND (
         a.is_general = true
         OR EXISTS (SELECT 1 FROM app_access aa WHERE aa.app_id=a.id AND aa.department_id=$2)
         OR EXISTS (SELECT 1 FROM app_admins ax WHERE ax.app_id=a.id AND ax.employee_id=$3)
         OR EXISTS (SELECT 1 FROM employee_app_access eg WHERE eg.app_id=a.id AND eg.employee_id=$3 AND eg.allow=true)
       )
       AND NOT EXISTS (SELECT 1 FROM employee_app_access er WHERE er.app_id=a.id AND er.employee_id=$3 AND er.allow=false)
       ORDER BY a.launcher_group, a.sort_order, a.name`,
      [emp.company_id, emp.department_id, emp.id]
    )).rows;
  }

  const adminApps = new Set();
  if (emp.role === 'super_admin' || emp.role === 'company_admin') {
    rows.forEach(r => adminApps.add(r.id));
  } else {
    const ax = (await pool.query(`SELECT app_id FROM app_admins WHERE employee_id=$1`, [emp.id])).rows;
    ax.forEach(r => adminApps.add(r.app_id));
  }

  return rows.map(a => ({
    key: a.key,
    name: a.name,
    group: a.launcher_group,
    type: a.type,
    embed_url: a.embed_url,
    is_admin: adminApps.has(a.id),
  }));
}

function publicEmp(e) {
  return {
    emp_code: e.emp_code,
    name: e.name,
    role: e.role,
    department_id: e.department_id,
    company_id: e.company_id,
    company_code: e.company_code,
    expense_cat: e.expense_cat,
    must_reset: e.must_reset,
  };
}

router.post('/login', async (req, res) => {
  const { emp_code, password } = req.body || {};
  if (!emp_code || !password) {
    return res.status(400).json({ ok: false, error: 'Employee code and password are required' });
  }
  const e = (await pool.query(
    `SELECT e.*, c.code AS company_code FROM employees e
     JOIN companies c ON c.id = e.company_id WHERE e.emp_code=$1`, [emp_code])).rows[0];
  if (!e || !e.active || !e.password_hash) {
    return res.status(401).json({ ok: false, error: 'Invalid employee code or password' });
  }
  const ok = await bcrypt.compare(password, e.password_hash);
  if (!ok) {
    return res.status(401).json({ ok: false, error: 'Invalid employee code or password' });
  }
  res.json({ ok: true, token: signToken(e), must_reset: e.must_reset, employee: publicEmp(e) });
});

router.post('/change-password', requireAuth, async (req, res) => {
  const { current_password, new_password } = req.body || {};
  if (!current_password || !new_password) {
    return res.status(400).json({ ok: false, error: 'Current and new password are required' });
  }
  if (new_password.length < 6) {
    return res.status(400).json({ ok: false, error: 'New password must be at least 6 characters' });
  }
  if (new_password === DEFAULT_PASSWORD) {
    return res.status(400).json({ ok: false, error: 'Please choose a password different from the default' });
  }
  const e = (await pool.query(`SELECT * FROM employees WHERE id=$1`, [req.user.id])).rows[0];
  if (!e) return res.status(404).json({ ok: false, error: 'Employee not found' });
  const ok = await bcrypt.compare(current_password, e.password_hash);
  if (!ok) return res.status(401).json({ ok: false, error: 'Current password is incorrect' });
  const hash = await bcrypt.hash(new_password, 10);
  await pool.query(`UPDATE employees SET password_hash=$1, must_reset=false WHERE id=$2`, [hash, e.id]);
  res.json({ ok: true });
});

router.post('/reset-request', async (req, res) => {
  const { emp_code } = req.body || {};
  if (!emp_code) return res.status(400).json({ ok: false, error: 'Employee code is required' });
  const e = (await pool.query(`SELECT id FROM employees WHERE emp_code=$1 AND active=true`, [emp_code])).rows[0];
  if (e) {
    const pending = (await pool.query(
      `SELECT 1 FROM password_resets WHERE employee_id=$1 AND status='pending'`, [e.id]
    )).rows[0];
    if (!pending) await pool.query(`INSERT INTO password_resets (employee_id) VALUES ($1)`, [e.id]);
  }
  res.json({ ok: true, message: 'If that employee code exists, a reset request has been sent to the admin.' });
});

router.get('/me', requireAuth, async (req, res) => {
  const e = (await pool.query(
    `SELECT e.*, c.code AS company_code FROM employees e
     JOIN companies c ON c.id = e.company_id WHERE e.id=$1`, [req.user.id])).rows[0];
  if (!e) return res.status(404).json({ ok: false, error: 'Employee not found' });
  res.json({ ok: true, employee: publicEmp(e), apps: await appsFor(e) });
});

module.exports = router;
