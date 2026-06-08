const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

function signToken(emp) {
  return jwt.sign(
    { id: emp.id, emp_code: emp.emp_code, role: emp.role, company_id: emp.company_id },
    SECRET,
    { expiresIn: '7d' }
  );
}

function requireAuth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ ok: false, error: 'Not logged in' });
  try {
    req.user = jwt.verify(token, SECRET);
    next();
  } catch {
    return res.status(401).json({ ok: false, error: 'Session expired, please log in again' });
  }
}

module.exports = { signToken, requireAuth };
