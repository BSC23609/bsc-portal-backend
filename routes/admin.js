const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const ROLES = ['super_admin', 'company_admin', 'app_admin', 'employee'];
const CATS = ['L1', 'L2'];

function requireSuperAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'super_admin') {
    return res.status(403).json({ ok: false, error: 'Not allowed' });
  }
  next();
}
router.use(requireAuth, requireSuperAdmin);

async function deptBelongsToCompany(departmentId, companyId) {
  if (departmentId == null) return true;
  const r = await pool.query(
    `SELECT 1 FROM departments WHERE id=$1 AND company_id=$2`, [departmentId, companyId]);
  return r.rowCount > 0;
}

// Dropdown data for the employee form
router.get('/meta', async (req, res) => {
  const companies = (await pool.query(`SELECT id, code, name FROM companies ORDER BY id`)).rows;
  const departments = (await pool.query(`SELECT id, company_id, name FROM departments ORDER BY name`)).rows;
  res.json({ ok: true, companies, departments, roles: ROLES, categories: CATS });
});

// List all employees (ids included so the edit form can pre-fill)
router.get('/employees', async (req, res) => {
  const rows = (await pool.query(
    `SELECT e.id, e.emp_code, e.name, e.email, e.mobile, e.role, e.expense_cat, e.active,
            e.company_id, c.code AS company_code, e.department_id, d.name AS department
     FROM employees e
     JOIN companies c ON c.id = e.company_id
     LEFT JOIN departments d ON d.id = e.department_id
     ORDER BY e.name`
  )).rows;
  res.json({ ok: true, employees: rows });
});

// Create employee (starts on Bsc@123, must reset, active)
router.post('/employees', async (req, res) => {
  const { emp_code, name, email, mobile, company_id, department_id, role, expense_cat } = req.body || {};
  if (!emp_code || !name || !company_id) {
    return res.status(400).json({ ok: false, error: 'Employee code, name and company are required' });
  }
  if (role && !ROLES.includes(role)) return res.status(400).json({ ok: false, error: 'Invalid role' });
  if (expense_cat && !CATS.includes(expense_cat)) return res.status(400).json({ ok: false, error: 'Invalid category' });
  const comp = await pool.query(`SELECT 1 FROM companies WHERE id=$1`, [company_id]);
  if (comp.rowCount === 0) return res.status(400).json({ ok: false, error: 'Unknown company' });
  if (!(await deptBelongsToCompany(department_id || null, company_id))) {
    return res.status(400).json({ ok: false, error: 'Department does not belong to that company' });
  }
  try {
    const hash = await bcrypt.hash('Bsc@123', 10);
    const r = await pool.query(
      `INSERT INTO employees
        (emp_code,name,email,mobile,company_id,department_id,role,expense_cat,password_hash,must_reset,active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true,true) RETURNING id`,
      [emp_code.trim(), name.trim(), email || null, mobile || null, company_id,
       department_id || null, role || 'employee', expense_cat || null, hash]);
    res.json({ ok: true, id: r.rows[0].id });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ ok: false, error: 'That employee code already exists' });
    throw e;
  }
});

// Update editable fields (not emp_code, not password)
router.put('/employees/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { name, email, mobile, company_id, department_id, role, expense_cat, active } = req.body || {};
  if (!name || !company_id) return res.status(400).json({ ok: false, error: 'Name and company are required' });
  if (role && !ROLES.includes(role)) return res.status(400).json({ ok: false, error: 'Invalid role' });
  if (expense_cat && !CATS.includes(expense_cat)) return res.status(400).json({ ok: false, error: 'Invalid category' });
  if (!(await deptBelongsToCompany(department_id || null, company_id))) {
    return res.status(400).json({ ok: false, error: 'Department does not belong to that company' });
  }
  const r = await pool.query(
    `UPDATE employees SET name=$1, email=$2, mobile=$3, company_id=$4, department_id=$5,
            role=$6, expense_cat=$7, active=$8 WHERE id=$9`,
    [name.trim(), email || null, mobile || null, company_id, department_id || null,
     role || 'employee', expense_cat || null, active !== false, id]);
  if (r.rowCount === 0) return res.status(404).json({ ok: false, error: 'Employee not found' });
  res.json({ ok: true });
});

// Quick activate / deactivate
router.post('/employees/:id/status', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const active = req.body && req.body.active === true;
  const r = await pool.query(`UPDATE employees SET active=$1 WHERE id=$2`, [active, id]);
  if (r.rowCount === 0) return res.status(404).json({ ok: false, error: 'Employee not found' });
  res.json({ ok: true });
});

// Per-employee app access (overrides + app-admin flags)
router.get('/employees/:id/access', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const emp = (await pool.query(
    `SELECT id, company_id, department_id FROM employees WHERE id=$1`, [id])).rows[0];
  if (!emp) return res.status(404).json({ ok: false, error: 'Employee not found' });
  const apps = (await pool.query(
    `SELECT id, key, name, launcher_group, is_general FROM apps
     WHERE company_id=$1 AND active=true ORDER BY launcher_group, sort_order, name`,
    [emp.company_id])).rows;
  const deptAllowed = new Set((await pool.query(
    `SELECT app_id FROM app_access WHERE department_id=$1`, [emp.department_id])).rows.map(r => r.app_id));
  const adminSet = new Set((await pool.query(
    `SELECT app_id FROM app_admins WHERE employee_id=$1`, [id])).rows.map(r => r.app_id));
  const overrides = {};
  for (const r of (await pool.query(
    `SELECT app_id, allow FROM employee_app_access WHERE employee_id=$1`, [id])).rows) {
    overrides[r.app_id] = r.allow;
  }
  res.json({
    ok: true,
    apps: apps.map(a => ({
      app_id: a.id,
      key: a.key,
      name: a.name,
      group: a.launcher_group,
      dept_default: a.is_general || deptAllowed.has(a.id),
      is_admin: adminSet.has(a.id),
      override: overrides[a.id] === true ? 'granted'
              : overrides[a.id] === false ? 'restricted' : 'default',
    })),
  });
});

router.post('/employees/:id/access', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const apps = (req.body && req.body.apps) || [];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const emp = (await client.query(`SELECT id FROM employees WHERE id=$1`, [id])).rows[0];
    if (!emp) {
      await client.query('ROLLBACK');
      return res.status(404).json({ ok: false, error: 'Employee not found' });
    }
    for (const a of apps) {
      if (a.override === 'granted' || a.override === 'restricted') {
        await client.query(
          `INSERT INTO employee_app_access (employee_id, app_id, allow) VALUES ($1,$2,$3)
           ON CONFLICT (employee_id, app_id) DO UPDATE SET allow=EXCLUDED.allow`,
          [id, a.app_id, a.override === 'granted']);
      } else {
        await client.query(
          `DELETE FROM employee_app_access WHERE employee_id=$1 AND app_id=$2`, [id, a.app_id]);
      }
      if (a.admin === true) {
        await client.query(
          `INSERT INTO app_admins (employee_id, app_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
          [id, a.app_id]);
      } else {
        await client.query(
          `DELETE FROM app_admins WHERE employee_id=$1 AND app_id=$2`, [id, a.app_id]);
      }
    }
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ ok: false, error: e.message });
  } finally {
    client.release();
  }
});

// Pending password reset requests
router.get('/reset-requests', async (req, res) => {
  const rows = (await pool.query(
    `SELECT r.id, r.requested_at, e.emp_code, e.name
     FROM password_resets r JOIN employees e ON e.id = r.employee_id
     WHERE r.status='pending' ORDER BY r.requested_at ASC`)).rows;
  res.json({ ok: true, requests: rows });
});

// Approve: reset the employee's password to the default and force a change at next login
router.post('/reset-requests/:id/approve', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const reqRow = (await client.query(
      `SELECT * FROM password_resets WHERE id=$1 AND status='pending'`, [id])).rows[0];
    if (!reqRow) {
      await client.query('ROLLBACK');
      return res.status(404).json({ ok: false, error: 'Request not found or already handled' });
    }
    const hash = await bcrypt.hash('Bsc@123', 10);
    await client.query(
      `UPDATE employees SET password_hash=$1, must_reset=true WHERE id=$2`, [hash, reqRow.employee_id]);
    await client.query(
      `UPDATE password_resets SET status='completed', approved_by=$1, resolved_at=now() WHERE id=$2`,
      [req.user.emp_code, id]);
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ ok: false, error: e.message });
  } finally {
    client.release();
  }
});

// Deny
router.post('/reset-requests/:id/deny', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const r = await pool.query(
    `UPDATE password_resets SET status='denied', approved_by=$1, resolved_at=now()
     WHERE id=$2 AND status='pending'`, [req.user.emp_code, id]);
  if (r.rowCount === 0) return res.status(404).json({ ok: false, error: 'Request not found or already handled' });
  res.json({ ok: true });
});

module.exports = router;
