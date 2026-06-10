-- BSC Group Portal — core identity & access schema
-- Idempotent: safe to re-run on every deploy.

CREATE TABLE IF NOT EXISTS companies (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  code        TEXT UNIQUE NOT NULL,
  logo        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS departments (
  id          SERIAL PRIMARY KEY,
  company_id  INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  UNIQUE (company_id, name)
);

CREATE TABLE IF NOT EXISTS employees (
  id             SERIAL PRIMARY KEY,
  emp_code       TEXT UNIQUE NOT NULL,           -- login id, e.g. BSC/017, CMD, CEO
  name           TEXT NOT NULL,
  email          TEXT,
  mobile         TEXT,                           -- WhatsApp number
  company_id     INTEGER NOT NULL REFERENCES companies(id),
  department_id  INTEGER REFERENCES departments(id),
  role           TEXT NOT NULL DEFAULT 'employee'
                 CHECK (role IN ('super_admin','company_admin','app_admin','employee')),
  expense_cat    TEXT CHECK (expense_cat IN ('L1','L2')),
  password_hash  TEXT,
  must_reset     BOOLEAN NOT NULL DEFAULT true,  -- forces password change on first login
  active         BOOLEAN NOT NULL DEFAULT true,
  dob            DATE,
  gender         TEXT,
  blood_group    TEXT,
  job_title      TEXT,
  reporting_to   TEXT,                           -- manager (may reference another company)
  date_joined    DATE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS apps (
  id              SERIAL PRIMARY KEY,
  key             TEXT UNIQUE NOT NULL,          -- e.g. outpass, ticket, expense
  name            TEXT NOT NULL,
  company_id      INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  launcher_group  TEXT NOT NULL DEFAULT 'General',
  type            TEXT NOT NULL DEFAULT 'native' CHECK (type IN ('native','embed')),
  embed_url       TEXT,                          -- set when type = embed
  is_general      BOOLEAN NOT NULL DEFAULT false,-- true = visible to everyone in company
  sort_order      INTEGER NOT NULL DEFAULT 0,
  active          BOOLEAN NOT NULL DEFAULT true
);

-- Which departments may open a (non-general) app
CREATE TABLE IF NOT EXISTS app_access (
  app_id         INTEGER NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  department_id  INTEGER NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  PRIMARY KEY (app_id, department_id)
);

-- Which employees are App Admins of which apps
CREATE TABLE IF NOT EXISTS app_admins (
  employee_id  INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  app_id       INTEGER NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  PRIMARY KEY (employee_id, app_id)
);

-- Admin-approved password reset requests
CREATE TABLE IF NOT EXISTS password_resets (
  id            SERIAL PRIMARY KEY,
  employee_id   INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','approved','denied','completed')),
  requested_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_by   TEXT,
  resolved_at   TIMESTAMPTZ
);

-- Per-employee app access overrides (grant or restrict beyond department defaults)
CREATE TABLE IF NOT EXISTS employee_app_access (
  employee_id  INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  app_id       INTEGER NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  allow        BOOLEAN NOT NULL,   -- true = granted, false = restricted
  PRIMARY KEY (employee_id, app_id)
);

CREATE INDEX IF NOT EXISTS idx_employees_company   ON employees(company_id);
CREATE INDEX IF NOT EXISTS idx_employees_dept      ON employees(department_id);
CREATE INDEX IF NOT EXISTS idx_apps_company        ON apps(company_id);
CREATE INDEX IF NOT EXISTS idx_resets_status       ON password_resets(status);

-- Outpass / Gatepass requests
CREATE TABLE IF NOT EXISTS outpass_requests (
  id             SERIAL PRIMARY KEY,
  ref            TEXT UNIQUE NOT NULL,
  employee_id    INTEGER NOT NULL REFERENCES employees(id),
  type           TEXT NOT NULL CHECK (type IN ('outpass','gatepass')),
  on_duty        BOOLEAN NOT NULL DEFAULT false,
  entry_date     DATE NOT NULL,
  purpose        TEXT NOT NULL,
  out_time       TEXT NOT NULL,
  in_time        TEXT,
  approver_id    INTEGER NOT NULL REFERENCES employees(id),
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reject_reason  TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_outpass_employee ON outpass_requests(employee_id);
CREATE INDEX IF NOT EXISTS idx_outpass_approver ON outpass_requests(approver_id, status);
