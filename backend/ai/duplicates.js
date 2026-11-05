// AI FEATURE 2: Smart duplicate prevention.
// Step 1 (geo filter): open issues of the same department within DUP_RADIUS_M.
// Step 2 (AI): decide whether the new photo shows the same physical problem.
//   - With a Gemini key: Gemini compares both photos + descriptions.
//   - Always available: local CLIP image fingerprints (cosine similarity).
const fs = require('fs');
const path = require('path');
const db = require('../../db/database');
const { askVisionJSON, activeProvider } = require('./llm');
const { cosine } = require('./localVision');
const { distanceMeters } = require('../services/geo');

const DUP_RADIUS_M = Number(process.env.DUP_RADIUS_M || 250);
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');

// Calibrated on test photos: same scene re-framed scored 0.85-0.93, different problems scored below 0.72.
const SIM_STRONG = 0.85;          // same department, anywhere within DUP_RADIUS_M
const SIM_NEAR = 0.75;            // same category and within NEAR_M
const NEAR_M = 60;

const SCHEMA = {
  type: 'object',
  properties: {
    same_issue: { type: 'boolean' },
    confidence: { type: 'number' },
    reason: { type: 'string' },
  },
  required: ['same_issue', 'confidence', 'reason'],
  additionalProperties: false,
};

const SYSTEM = `You detect duplicate civic complaints. Two reports are duplicates only if they show the SAME physical problem at the same spot
(the same pothole, the same garbage pile, the same broken streetlight), possibly photographed from a different angle or at a different time.
Two different potholes on the same street are NOT duplicates. Answer with same_issue, confidence (0-1) and a one-sentence reason.`;

function findCandidates({ department, latitude, longitude }) {
  const open = db.prepare(`SELECT * FROM issues WHERE department = ? AND status != 'Resolved'`).all(department);
  return open
    .map((issue) => ({ ...issue, distance: distanceMeters(latitude, longitude, issue.latitude, issue.longitude) }))
    .filter((issue) => issue.distance <= DUP_RADIUS_M)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 5);
}

function bySimilarity(candidates, embedding, category) {
  if (!embedding) return null;
  let best = null;
  for (const c of candidates) {
    if (!c.image_embedding) continue;
    const sim = cosine(embedding, JSON.parse(c.image_embedding));
    const match = sim >= SIM_STRONG || (sim >= SIM_NEAR && c.category === category && c.distance <= NEAR_M);
    if (match && (!best || sim > best.similarity)) best = { issue: c, similarity: sim };
  }
  if (!best) return null;
  return {
    issue: best.issue,
    confidence: Number(best.similarity.toFixed(3)),
    method: 'local image fingerprint',
    reason: `Photo is ${Math.round(best.similarity * 100)}% visually similar to issue #${best.issue.id}, ${Math.round(best.issue.distance)} m away.`,
  };
}

async function findDuplicate({ department, category, latitude, longitude, imagePath, mediaType, title, description, embedding }) {
  const candidates = findCandidates({ department, latitude, longitude });
  if (candidates.length === 0) return null;

  const cloud = activeProvider();
  if (cloud) {
    const newImage = fs.readFileSync(imagePath).toString('base64');
    let cloudWorked = false;
    for (const c of candidates.slice(0, 3)) {
      const candidatePath = path.join(UPLOAD_DIR, path.basename(c.image_path));
      if (!fs.existsSync(candidatePath)) continue;
      try {
        const verdict = await askVisionJSON({
          system: SYSTEM,
          schema: SCHEMA,
          parts: [
            { text: `EXISTING report #${c.id} (${Math.round(c.distance)} m away): "${c.title}" - ${c.description}` },
            { image: { base64: fs.readFileSync(candidatePath).toString('base64'), mediaType: mimeFromPath(candidatePath) } },
            { text: `NEW report: "${title}" - ${description}` },
            { image: { base64: newImage, mediaType } },
            { text: 'Do these two reports show the same physical problem?' },
          ],
        });
        cloudWorked = true;
        if (verdict.same_issue && verdict.confidence >= 0.6) {
          return { issue: c, confidence: verdict.confidence, method: cloud.label, reason: verdict.reason };
        }
      } catch (err) {
        console.warn('[duplicates] cloud comparison failed:', err.message);
      }
    }
    if (cloudWorked) return null;
  }

  return bySimilarity(candidates, embedding, category);
}

function mimeFromPath(p) {
  const ext = path.extname(p).toLowerCase();
  return { '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' }[ext] || 'image/jpeg';
}

module.exports = { findDuplicate, mimeFromPath };
