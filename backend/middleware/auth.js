const { msg } = require('../i18n');
const jwt = require('jsonwebtoken');

function sign(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '7d' });
}

function requireRole(role) {
  return (req, res, next) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: msg(req, 'pleaseLogin') });
    try {
      const user = jwt.verify(token, process.env.JWT_SECRET);
      if (user.role !== role) return res.status(403).json({ error: msg(req, 'notAllowed') });
      req.user = user;
      next();
    } catch {
      res.status(401).json({ error: msg(req, 'sessionExpired') });
    }
  };
}

module.exports = { sign, requireCitizen: requireRole('citizen'), requireAdmin: requireRole('admin') };
