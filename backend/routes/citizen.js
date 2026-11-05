const { msg } = require('../i18n');
const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const db = require('../../db/database');
const { requireCitizen } = require('../middleware/auth');
const { classifyIssue } = require('../ai/classifier');
const { findDuplicate } = require('../ai/duplicates');
const { computeSeverity } = require('../ai/severity');
const { attachArea } = require('../ai/areaPriority');
const { nearbyFacilities, reverseGeocode } = require('../services/geo');

const router = express.Router();
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, crypto.randomUUID() + ALLOWED[file.mimetype]),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, Boolean(ALLOWED[file.mimetype])),
});

router.use(requireCitizen);

// Each analysis is saved in the ai_analyses table; its id is the draft id the citizen submits.
function saveAnalysis({ citizenId, file, mediaType, voiceText, a }) {
  const info = db.prepare(`INSERT INTO ai_analyses
    (citizen_id, image_path, media_type, voice_text, provider, provider_label, provider_error, is_civic_issue,
     category, department, confidence, title, description, visual_severity, severity_reason, local_scores, embedding)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    citizenId, file, mediaType, voiceText || null, a.provider, a.provider_label, a.provider_error, a.is_civic_issue ? 1 : 0,
    a.category, a.department, a.confidence, a.title, a.description, a.visual_severity, a.severity_reason,
    a.local_scores ? JSON.stringify(a.local_scores) : null, a.embedding ? JSON.stringify(a.embedding) : null
  );
  return Number(info.lastInsertRowid);
}

function loadDraft(id, citizenId) {
  const row = db.prepare('SELECT * FROM ai_analyses WHERE id = ? AND citizen_id = ?').get(Number(id), citizenId);
  if (!row) return null;
  return {
    id: row.id, file: row.image_path, mediaType: row.media_type, submitted: row.issue_id != null,
    analysis: {
      is_civic_issue: Boolean(row.is_civic_issue), category: row.category, department: row.department,
      confidence: row.confidence, title: row.title, description: row.description,
      visual_severity: row.visual_severity, severity_reason: row.severity_reason,
      provider: row.provider, provider_label: row.provider_label,
      embedding: row.embedding ? JSON.parse(row.embedding) : null,
    },
  };
}

function publicAnalysis(a) {
  const { embedding, ...rest } = a;
  const dept = db.prepare('SELECT name FROM departments WHERE code = ?').get(a.department);
  return { ...rest, departmentName: dept.name };
}

/**
 * Step 1: citizen takes a photo -> AI classifies it and writes title + description.
 * Send multipart `image` for a new photo, or JSON { draftId, voiceText } to
 * re-run the analysis with a new voice note.
 */
router.post('/analyze', upload.single('image'), async (req, res) => {
  try {
    let file, mediaType;
    if (req.file) {
      file = req.file.filename;
      mediaType = req.file.mimetype;
    } else {
      const prev = loadDraft(req.body.draftId, req.user.id);
      if (!prev) return res.status(400).json({ error: msg(req, 'needPhoto') });
      file = prev.file;
      mediaType = prev.mediaType;
    }

    const voiceText = req.body.voiceText || '';
    const analysis = await classifyIssue({ imagePath: path.join(UPLOAD_DIR, file), mediaType, voiceText });
    const draftId = saveAnalysis({ citizenId: req.user.id, file, mediaType, voiceText, a: analysis });

    res.json({ draftId, imageUrl: '/uploads/' + file, analysis: publicAnalysis(analysis) });
  } catch (err) {
    console.error('[analyze]', err);
    res.status(502).json({ error: msg(req, 'analysisFailed', { err: err.message }) });
  }
});

/** Step 2: submit -> duplicate check, prioritization, severity, save. */
router.post('/issues', async (req, res) => {
  const { draftId, title, description, voiceText } = req.body || {};
  const latitude = Number(req.body?.latitude);
  const longitude = Number(req.body?.longitude);

  const draft = loadDraft(draftId, req.user.id);
  if (!draft) return res.status(400).json({ error: msg(req, 'photoNotFound') });
  if (draft.submitted) return res.status(409).json({ error: msg(req, 'alreadySubmitted') });
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return res.status(400).json({ error: msg(req, 'needGps') });
  if (!draft.analysis.is_civic_issue) return res.status(422).json({ error: msg(req, 'notCivic') });

  const a = draft.analysis;
  const finalTitle = (title || a.title).trim().slice(0, 120);
  const finalDescription = (description || a.description).trim().slice(0, 2000);
  const imagePath = '/uploads/' + draft.file;

  try {
    // AI FEATURE 2: duplicate prevention
    const duplicate = await findDuplicate({
      department: a.department, category: a.category, latitude, longitude,
      imagePath: path.join(UPLOAD_DIR, draft.file), mediaType: draft.mediaType,
      title: finalTitle, description: finalDescription, embedding: a.embedding,
    });

    let issueId;
    let merged = false;

    if (duplicate) {
      merged = true;
      issueId = duplicate.issue.id;
      insertReport({ issueId, citizenId: req.user.id, title: finalTitle, description: finalDescription, voiceText, imagePath, latitude, longitude, isDuplicate: 1, analysisId: draft.id, duplicate });

      // AI FEATURES 3 + 4: re-prioritise with the new report count
      const issue = db.prepare('SELECT * FROM issues WHERE id = ?').get(issueId);
      const reportCount = db.prepare('SELECT COUNT(DISTINCT citizen_id) AS n FROM reports WHERE issue_id = ?').get(issueId).n;
      const aiSeverity = Math.max(issue.ai_severity, a.visual_severity);
      const prev = JSON.parse(issue.severity_breakdown || '{}');
      const sev = computeSeverity({
        aiSeverity, reportCount,
        facilities: JSON.parse(issue.nearby_facilities || '[]'),
        severityReason: aiSeverity > issue.ai_severity ? a.severity_reason : prev.ai_reason,
      });
      db.prepare(`UPDATE issues SET report_count = ?, ai_severity = ?, severity = ?, priority = ?, severity_breakdown = ?, updated_at = datetime('now') WHERE id = ?`)
        .run(reportCount, aiSeverity, sev.score, sev.priority, JSON.stringify(sev.breakdown), issueId);
    } else {
      // AI FEATURE 3: look for hospitals / fire stations etc. within 1 km
      const [facilities, address] = await Promise.all([nearbyFacilities(latitude, longitude), reverseGeocode(latitude, longitude)]);
      // AI FEATURE 4: severity score 1-10
      const sev = computeSeverity({ aiSeverity: a.visual_severity, reportCount: 1, facilities, severityReason: a.severity_reason });

      const info = db.prepare(`INSERT INTO issues
        (title, description, category, department, image_path, latitude, longitude, address,
         ai_severity, severity, priority, severity_breakdown, nearby_facilities, ai_confidence, created_by,
         ai_provider, image_embedding)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        finalTitle, finalDescription, a.category, a.department, imagePath, latitude, longitude, address,
        a.visual_severity, sev.score, sev.priority, JSON.stringify(sev.breakdown), JSON.stringify(facilities), a.confidence, req.user.id,
        a.provider_label, a.embedding ? JSON.stringify(a.embedding) : null
      );
      issueId = Number(info.lastInsertRowid);
      insertReport({ issueId, citizenId: req.user.id, title: finalTitle, description: finalDescription, voiceText, imagePath, latitude, longitude, isDuplicate: 0, analysisId: draft.id });
      db.prepare(`INSERT INTO status_history (issue_id, status, changed_by, note) VALUES (?, 'Submitted', ?, 'Reported by citizen')`).run(issueId, req.user.name);
    }

    db.prepare('UPDATE ai_analyses SET issue_id = ? WHERE id = ?').run(issueId, draft.id);
    const issue = db.prepare('SELECT i.*, d.name AS department_name FROM issues i JOIN departments d ON d.code = i.department WHERE i.id = ?').get(issueId);
    res.status(201).json({
      message: merged
        ? `Issue submitted successfully! It matched an existing report nearby, so it was merged (now ${issue.report_count} citizens). This raises its priority.`
        : 'Issue submitted successfully!',
      merged,
      duplicateReason: duplicate?.reason || null,
      issue: attachArea([formatIssue(issue)])[0],
    });
  } catch (err) {
    console.error('[submit]', err);
    res.status(500).json({ error: msg(req, 'submitFailed', { err: err.message }) });
  }
});

/** Citizen's own submission history with live status and severity. */
router.get('/issues', (req, res) => {
  const rows = db.prepare(`
    SELECT r.id AS report_id, r.title AS my_title, r.image_path AS my_image, r.created_at AS reported_at, r.is_duplicate,
           i.*, d.name AS department_name
    FROM reports r
    JOIN issues i ON i.id = r.issue_id
    JOIN departments d ON d.code = i.department
    WHERE r.citizen_id = ?
    ORDER BY r.created_at DESC, r.id DESC`).all(req.user.id);
  res.json(attachArea(rows.map((r) => ({ ...formatIssue(r), report_id: r.report_id, my_title: r.my_title, my_image: r.my_image, reported_at: r.reported_at, is_duplicate: Boolean(r.is_duplicate) }))));
});

function insertReport({ issueId, citizenId, title, description, voiceText, imagePath, latitude, longitude, isDuplicate, analysisId, duplicate }) {
  db.prepare(`INSERT INTO reports (issue_id, citizen_id, title, description, voice_text, image_path, latitude, longitude, is_duplicate,
                                   analysis_id, duplicate_method, duplicate_reason, duplicate_score)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(issueId, citizenId, title, description, voiceText || null, imagePath, latitude, longitude, isDuplicate,
      analysisId ?? null, duplicate?.method ?? null, duplicate?.reason ?? null, duplicate?.confidence ?? null);
}

function formatIssue(i) {
  return {
    id: i.id, title: i.title, description: i.description, category: i.category,
    department: i.department, department_name: i.department_name, image_path: i.image_path,
    latitude: i.latitude, longitude: i.longitude, address: i.address, status: i.status,
    severity: i.severity, priority: i.priority, ai_severity: i.ai_severity,
    severity_breakdown: JSON.parse(i.severity_breakdown || '{}'),
    report_count: i.report_count, created_at: i.created_at, updated_at: i.updated_at,
    ai_provider: i.ai_provider, ai_confidence: i.ai_confidence,
    resolution_image: i.resolution_image, resolved_at: i.resolved_at,
  };
}

module.exports = router;
module.exports.formatIssue = formatIssue;
