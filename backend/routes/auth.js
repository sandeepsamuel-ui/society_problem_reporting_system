const { msg } = require('../i18n');
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../../db/database');
const { sign } = require('../middleware/auth');

const router = express.Router();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.get('/departments', (req, res) => {
  res.json(db.prepare('SELECT code, name FROM departments ORDER BY name').all());
});

// ---------- Citizen ----------
router.post('/citizen/register', async (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name?.trim() || !EMAIL_RE.test(email || '') || (password || '').length < 6) {
    return res.status(400).json({ error: msg(req, 'citizenFields') });
  }
  const normalized = email.trim().toLowerCase();
  if (db.prepare('SELECT 1 FROM citizens WHERE email = ?').get(normalized)) {
    return res.status(409).json({ error: msg(req, 'emailExists') });
  }
  const hash = await bcrypt.hash(password, 10);
  db.prepare('INSERT INTO citizens (name, email, password_hash) VALUES (?, ?, ?)').run(name.trim(), normalized, hash);
  res.status(201).json({ message: msg(req, 'registered') });
});

router.post('/citizen/login', async (req, res) => {
  const { email, password } = req.body || {};
  const user = db.prepare('SELECT * FROM citizens WHERE email = ?').get((email || '').trim().toLowerCase());
  if (!user || !(await bcrypt.compare(password || '', user.password_hash))) {
    return res.status(401).json({ error: msg(req, 'badLogin') });
  }
  const profile = { id: user.id, name: user.name, email: user.email, role: 'citizen' };
  res.json({ token: sign(profile), user: profile });
});

// ---------- Department admin ----------
router.post('/admin/register', async (req, res) => {
  const { name, department, email, password } = req.body || {};
  const dept = db.prepare('SELECT * FROM departments WHERE code = ?').get(department || '');
  if (!name?.trim() || !dept || !EMAIL_RE.test(email || '') || (password || '').length < 6) {
    return res.status(400).json({ error: msg(req, 'adminFields') });
  }
  const normalized = email.trim().toLowerCase();
  if (db.prepare('SELECT 1 FROM admins WHERE email = ?').get(normalized)) {
    return res.status(409).json({ error: msg(req, 'deptEmailExists') });
  }
  const hash = await bcrypt.hash(password, 10);
  db.prepare('INSERT INTO admins (name, department, email, password_hash) VALUES (?, ?, ?, ?)')
    .run(name.trim(), dept.code, normalized, hash);
  res.status(201).json({ message: msg(req, 'adminRegistered') });
});

// Admin logs in by choosing the department and entering the password.
router.post('/admin/login', async (req, res) => {
  const { department, password } = req.body || {};
  const admins = db.prepare('SELECT * FROM admins WHERE department = ?').all(department || '');
  for (const admin of admins) {
    if (await bcrypt.compare(password || '', admin.password_hash)) {
      const dept = db.prepare('SELECT name FROM departments WHERE code = ?').get(admin.department);
      const profile = {
        id: admin.id, name: admin.name, email: admin.email, role: 'admin',
        department: admin.department, departmentName: dept.name,
      };
      return res.json({ token: sign(profile), user: profile });
    }
  }
  res.status(401).json({ error: msg(req, 'badAdminLogin') });
});

module.exports = router;
