const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { pool } = require('./db');

const DEFAULT_PASSWORD = 'Bsc@123';

const COMPANIES = [
  { code: 'BSC', name: 'Bharat Steel (Chennai) Pvt. Ltd.' },
  { code: 'MET', name: 'Metfraa Steel Buildings Pvt. Ltd.' },
  { code: 'CRS', name: 'Crayon Roofings & Structures' },
  { code: 'G2S', name: 'G2 Steel Services Pvt. Ltd.' },
];

const BSC_DEPARTMENTS = [
  'Production', 'Sales', 'Accounts', 'Dispatch', 'Management',
  'Marketing', 'Purchase', 'Logistics', 'Admin', 'IT',
];

const BSC_APPS = [
  { key: 'outpass',            name: 'Outpass / Gatepass',    group: 'General',    type: 'native', general: true },
  { key: 'ticket',             name: 'Ticket Management',     group: 'General',    type: 'native', general: true },
  { key: 'expense',            name: 'Expense Reimbursement', group: 'General',    type: 'embed',  general: true,  embed_url: '' },
  { key: 'quality_inspection', name: 'Quality Inspection',    group: 'Production', type: 'native', general: false, access: ['Production'] },
  { key: 'quality_complaint',  name: 'Quality Complaint',     group: 'Production', type: 'native', general: false, access: ['Production', 'Sales'] },
  { key: 'dispatch_tracking',  name: 'Dispatch Tracking',     group: 'Dispatch',   type: 'embed',  general: false, access: ['Dispatch', 'Logistics', 'Sales'], embed_url: 'https://dispatch.bharatsteels.in' },
];

const ROLE_MAP = {
  'Super Admin': 'super_admin',
  'Company Admin': 'company_admin',
  'Production Admin': 'app_admin',
  'HR Admin': 'app_admin',
  'User': 'employee',
};

const APP_ADMIN_APPS = {
  'Production Admin': ['quality_inspection', 'quality_complaint'],
  'HR Admin': ['outpass', 'expense', 'ticket'],
};

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const c of COMPANIES) {
      await client.query(
        `INSERT INTO companies (name, code) VALUES ($1,$2)
         ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name`,
        [c.name, c.code]
      );
    }
    const bsc = (await client.query(`SELECT id FROM companies WHERE code='BSC'`)).rows[0].id;

    for (const d of BSC_DEPARTMENTS) {
      await client.query(
        `INSERT INTO departments (company_id, name) VALUES ($1,$2)
         ON CONFLICT (company_id, name) DO NOTHING`,
        [bsc, d]
      );
    }
    const deptRows = (await client.query(`SELECT id, name FROM departments WHERE company_id=$1`, [bsc])).rows;
    const deptId = Object.fromEntries(deptRows.map(r => [r.name, r.id]));

    for (const a of BSC_APPS) {
      await client.query(
        `INSERT INTO apps (key, name, company_id, launcher_group, type, embed_url, is_general)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (key) DO UPDATE SET
           name=EXCLUDED.name, launcher_group=EXCLUDED.launcher_group,
           type=EXCLUDED.type, embed_url=EXCLUDED.embed_url, is_general=EXCLUDED.is_general`,
        [a.key, a.name, bsc, a.group, a.type, a.embed_url || null, !!a.general]
      );
    }
    const appRows = (await client.query(`SELECT id, key FROM apps WHERE company_id=$1`, [bsc])).rows;
    const appId = Object.fromEntries(appRows.map(r => [r.key, r.id]));

    for (const a of BSC_APPS) {
      if (a.general || !a.access) continue;
      for (const dname of a.access) {
        await client.query(
          `INSERT INTO app_access (app_id, department_id) VALUES ($1,$2)
           ON CONFLICT DO NOTHING`,
          [appId[a.key], deptId[dname]]
        );
      }
    }

    const employees = JSON.parse(fs.readFileSync(path.join(__dirname, 'employees.json'), 'utf8'));
    const hash = await bcrypt.hash(DEFAULT_PASSWORD, 10);
    for (const e of employees) {
      const role = ROLE_MAP[e.roster_role] || 'employee';
      const dept = e.department ? deptId[e.department] : null;
      // Note: on re-run, profile fields refresh but password_hash / must_reset are left as-is.
      await client.query(
        `INSERT INTO employees
          (emp_code,name,email,mobile,company_id,department_id,role,expense_cat,
           password_hash,must_reset,active,gender,blood_group,job_title,reporting_to,dob,date_joined)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true,true,$10,$11,$12,$13,$14,$15)
         ON CONFLICT (emp_code) DO UPDATE SET
           name=EXCLUDED.name, email=EXCLUDED.email, mobile=EXCLUDED.mobile,
           department_id=EXCLUDED.department_id, role=EXCLUDED.role,
           expense_cat=EXCLUDED.expense_cat, gender=EXCLUDED.gender,
           blood_group=EXCLUDED.blood_group, job_title=EXCLUDED.job_title,
           reporting_to=EXCLUDED.reporting_to, dob=EXCLUDED.dob, date_joined=EXCLUDED.date_joined`,
        [e.emp_code, e.name, e.email, e.mobile, bsc, dept, role, e.expense_cat, hash,
         e.gender, e.blood_group, e.job_title, e.reporting_to, e.dob, e.date_joined]
      );
    }

    for (const e of employees) {
      const apps = APP_ADMIN_APPS[e.roster_role];
      if (!apps) continue;
      const emp = (await client.query(`SELECT id FROM employees WHERE emp_code=$1`, [e.emp_code])).rows[0];
      for (const key of apps) {
        await client.query(
          `INSERT INTO app_admins (employee_id, app_id) VALUES ($1,$2)
           ON CONFLICT DO NOTHING`,
          [emp.id, appId[key]]
        );
      }
    }

    await client.query('COMMIT');
    console.log(`Seed complete: ${COMPANIES.length} companies, ${BSC_DEPARTMENTS.length} BSC departments, ${BSC_APPS.length} apps, ${employees.length} employees.`);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Seed failed:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
