# BSC Group Portal — Backend

The central "brain": holds companies, departments, employees, roles, app access,
and (in the next bricks) the login + password-reset flow.

Stack: Node + Express + PostgreSQL, deployed on Render.

## Files
- `schema.sql`  — the database tables (the approved data model). Re-runnable safely.
- `migrate.js`  — applies `schema.sql` to the database.
- `db.js`       — Postgres connection.
- `server.js`   — Express app. For now: `/health` and `/health/db`.
- `.env.example`— the environment variables to set.

## One-time setup on Render

1. **Push this folder to a new GitHub repo**, e.g. `BSC23609/bsc-portal-backend`.
2. **Create a PostgreSQL database** on Render (New → PostgreSQL). Copy its
   **Internal Database URL**.
3. **Create a Web Service** on Render from the repo:
   - Build command: `npm install`
   - Start command: `node server.js`
   - Environment variables:
     - `DATABASE_URL` = the Internal Database URL from step 2
     - `JWT_SECRET`   = any long random string
4. **Create the tables**: open the Web Service → **Shell** tab → run:
   ```
   npm run migrate
   ```
   You should see `Schema applied successfully.`
5. **Verify**: visit `https://<your-service>.onrender.com/health` (should say ok)
   and `/health/db` (should return a database timestamp).

## Local dev (optional)
Copy `.env.example` to `.env`, fill in a local Postgres URL, then:
```
npm install
npm run migrate
npm start
```

## Next bricks (not built yet)
- Seed the 4 companies, BSC's 10 departments, the 53 employees, and the apps.
- `/auth/login` (Employee Code + password, JWT) and the forced-reset-on-first-login.
- `/auth/reset-request` + admin approval loop.
