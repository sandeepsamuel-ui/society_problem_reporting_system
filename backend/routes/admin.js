const { msg } = require('../i18n');
const express = require('express');
const path = require('path');
const db = require('../../db/database');
const { requireAdmin } = require('../middleware/auth');
const { formatIssue } = require('./citizen');
const { upload, UPLOAD_DIR, mimeFromPath } = require('../services/upload');
const { verifyRepair } = require('../ai/verifier');
const { attachArea, sortByPriority } = require('../ai/areaPriority');

const router = express.Router();
router.use(requireAdmin);

const STATUSES = ['Submitted', 'In Progress', 'Resolved'];
const AREA_COLORS = ['red', 'orange', 'yellow'];

router.get('/stats', (req, res) => {
  const dept = req.user.department;
  const count = (where = '', ...args) => db.prepare(`SELECT COUNT(*) AS n FROM issues WHERE department = ? ${where}`).get(dept, ...args).n;
  const open = attachArea(db.prepare(`SELECT id, department, status FROM issues WHERE department = ? AND status != 'Resolved'`).all(dept));
  res.json({
    total: count(),
    submitted: count('AND status = ?', 'Submitted'),
    inProgress: count('AND status = ?', 'In Progress'),
    resolved: count('AND status = ?', 'Resolved'),
    critical: count("AND priority = 'Critical' AND status != 'Resolved'"),
    duplicatesMerged: db.prepare(`SELECT COUNT(*) AS n FROM reports r JOIN issues i ON i.id = r.issue_id WHERE i.department = ? AND r.is_duplicate = 1`).get(dept).n,
    redZone: open.filter((i) => i.area?.color === 'red').length,
    verifiedRepairs: db.prepare(`SELECT COUNT(*) AS n FROM issues WHERE department = ? AND resolution_image IS NOT NULL`).get(dept).n,
  });
});

// All issues of the admin's department: red area first, then orange, yellow; then severity.
router.get('/issues', (req, res) => {
  const { status, priority, area } = req.query;
  let sql = `SELECT i.*, d.name AS department_name, c.name AS reporter_name, c.email AS reporter_email
             FROM issues i JOIN departments d ON d.code = i.department JOIN citizens c ON c.id = i.created_by
             WHERE i.department = ?`;
  const args = [req.user.department];
  if (STATUSES.includes(status)) { sql += ' AND i.status = ?'; args.push(status); }
  if (['Low', 'Medium', 'High', 'Critical'].includes(priority)) { sql += ' AND i.priority = ?'; args.push(priority); }
  let rows = db.prepare(sql).all(...args).map((r) => ({ ...formatIssue(r), reporter_name: r.reporter_name, reporter_email: r.reporter_email }));
  rows = sortByPriority(attachArea(rows));
  if (AREA_COLORS.includes(area)) rows = rows.filter((r) => r.area?.color === area);
  res.json(rows);
});

router.get('/issues/:id', (req, res) => {
  const issue = db.prepare(`SELECT i.*, d.name AS department_name FROM issues i JOIN departments d ON d.code = i.department WHERE i.id = ? AND i.department = ?`)
    .get(Number(req.params.id), req.user.department);
  if (!issue) return res.status(404).json({ error: msg(req, 'issueNotFound') });

  const reports = db.prepare(`SELECT r.*, c.name AS citizen_name, c.email AS citizen_email FROM reports r JOIN citizens c ON c.id = r.citizen_id WHERE r.issue_id = ? ORDER BY r.created_at`).all(issue.id);
  const history = db.prepare('SELECT * FROM status_history WHERE issue_id = ? ORDER BY changed_at, id').all(issue.id);
  const repairChecks = db.prepare(`SELECT rc.*, a.name AS admin_name FROM repair_checks rc JOIN admins a ON a.id = rc.admin_id WHERE rc.issue_id = ? ORDER BY rc.id DESC`)
    .all(issue.id).map((c) => ({ ...c, image_path: '/uploads/' + c.image_path, details: JSON.parse(c.details || 'null') }));
  const [withArea] = attachArea([formatIssue(issue)]);
  res.json({ ...withArea, nearby_facilities: JSON.parse(issue.nearby_facilities || '[]'), reports, history, repair_checks: repairChecks });
});

router.patch('/issues/:id/status', (req, res) => {
  const { status, note } = req.body || {};
  if (!STATUSES.includes(status)) return res.status(400).json({ error: msg(req, 'badStatus') });
  const result = db.prepare(`UPDATE issues SET status = ?, updated_at = datetime('now') WHERE id = ? AND department = ?`)
    .run(status, Number(req.params.id), req.user.department);
  if (result.changes === 0) return res.status(404).json({ error: msg(req, 'issueNotFound') });
  db.prepare('INSERT INTO status_history (issue_id, status, changed_by, note) VALUES (?, ?, ?, ?)')
    .run(Number(req.params.id), status, `${req.user.name} (${req.user.departmentName})`, (note || '').slice(0, 500) || null);
  res.json({ message: msg(req, 'statusUpdated', { s: status }) });
});

/**
 * Mark an issue as done with a completion photo.
 * multipart: image, latitude, longitude (admin's GPS when the photo was taken), note (optional).
 * The AI compares it with the citizen's photo and checks the location; only a verified repair is marked Resolved.
 */
router.post('/issues/:id/complete', upload.single('image'), async (req, res) => {
  const issue = db.prepare('SELECT * FROM issues WHERE id = ? AND department = ?').get(Number(req.params.id), req.user.department);
  if (!issue) return res.status(404).json({ error: msg(req, 'issueNotFound') });
  if (issue.status === 'Resolved') return res.status(409).json({ error: msg(req, 'alreadyResolved') });
  if (!req.file) return res.status(400).json({ error: msg(req, 'needPhoto') });

  const latitude = req.body.latitude === undefined || req.body.latitude === '' ? NaN : Number(req.body.latitude);
  const longitude = req.body.longitude === undefined || req.body.longitude === '' ? NaN : Number(req.body.longitude);
  const note = (req.body.note || '').slice(0, 500) || null;
  const beforePath = path.join(UPLOAD_DIR, path.basename(issue.image_path));

  try {
    const result = await verifyRepair({
      issue,
      beforePath,
      beforeType: mimeFromPath(beforePath),
      after: { path: req.file.path, mediaType: req.file.mimetype, latitude, longitude },
    });
    const { gps, photo, verified } = result;

    const info = db.prepare(`INSERT INTO repair_checks
      (issue_id, admin_id, image_path, latitude, longitude, gps_distance, gps_ok, photo_method, same_place, problem_fixed,
       relevant, similarity, confidence, reason, details, verified, note)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      issue.id, req.user.id, req.file.filename,
      Number.isFinite(latitude) ? latitude : null, Number.isFinite(longitude) ? longitude : null,
      gps.distance, gps.ok ? 1 : 0, photo.method, photo.samePlace ? 1 : 0, photo.fixed ? 1 : 0,
      photo.relevant ? 1 : 0, photo.similarity ?? null, photo.confidence ?? null, photo.reason,
      JSON.stringify(result), verified ? 1 : 0, note
    );
    const checkId = Number(info.lastInsertRowid);

    if (verified) {
      db.prepare(`UPDATE issues SET status = 'Resolved', resolution_image = ?, resolution_check_id = ?, resolved_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`)
        .run('/uploads/' + req.file.filename, checkId, issue.id);
      db.prepare('INSERT INTO status_history (issue_id, status, changed_by, note) VALUES (?, ?, ?, ?)').run(
        issue.id, 'Resolved', `${req.user.name} (${req.user.departmentName})`,
        `✅ Repair verified by AI (${photo.method}). ${photo.reason} GPS: ${gps.distance} m from the reported location.${note ? ' Note: ' + note : ''}`
      );
    }

    res.json({
      verified,
      gps,
      photo,
      checkId,
      imageUrl: '/uploads/' + req.file.filename,
      message: msg(req, verified ? 'repairVerified' : 'repairRejected'),
    });
  } catch (err) {
    console.error('[complete]', err);
    res.status(500).json({ error: msg(req, 'verifyFailed', { err: err.message }) });
  }
});

// Every AI analysis routed to this department (stored in the ai_analyses table).
router.get('/ai-log', (req, res) => {
  const rows = db.prepare(`
    SELECT a.id, a.image_path, a.provider, a.provider_label, a.provider_error, a.category, a.confidence, a.title,
           a.visual_severity, a.severity_reason, a.local_scores, a.voice_text, a.issue_id, a.created_at,
           c.name AS citizen_name, r.is_duplicate, r.duplicate_method, r.duplicate_reason, r.duplicate_score
    FROM ai_analyses a
    JOIN citizens c ON c.id = a.citizen_id
    LEFT JOIN reports r ON r.analysis_id = a.id
    WHERE a.department = ?
    ORDER BY a.id DESC LIMIT 200`).all(req.user.department);
  res.json(rows.map((r) => ({ ...r, image_path: '/uploads/' + r.image_path, local_scores: JSON.parse(r.local_scores || 'null') })));
});

// Heatmap points weighted by severity and number of reports, with the area colour.
router.get('/heatmap', (req, res) => {
  const rows = db.prepare(`SELECT id, title, latitude, longitude, severity, report_count, status, priority, department FROM issues WHERE department = ?`).all(req.user.department);
  res.json(attachArea(rows));
});

module.exports = router;
