// Repair verification: the admin uploads a completion photo, and the AI compares it with the
// citizen's original photo and checks the GPS location. Only a verified repair marks the issue Resolved.
//
// Checks:
//   1. GPS      - completion photo taken within RESOLVE_RADIUS_M of the reported location
//   2. Relevant - the photo shows the site, not a person / room / document
//   3. Same place - the before and after photos show the same scene
//   4. Fixed    - the problem visible in the before photo is gone in the after photo
// With GEMINI_API_KEY set, Gemini judges checks 2-4 from both photos. Otherwise the local CLIP model does.
const fs = require('fs');
const localVision = require('./localVision');
const { askVisionJSON, activeProvider } = require('./llm');
const { distanceMeters } = require('../services/geo');

const RESOLVE_RADIUS_M = Number(process.env.RESOLVE_RADIUS_M || 150);

// What a repaired site looks like, per department (used by the local model).
const FIXED_PROMPTS = {
  ROADS: ['a photo of a smooth newly repaired asphalt road', 'a freshly patched road surface with no holes', 'a clean well maintained road'],
  GARBAGE: ['a photo of a clean street with no garbage', 'a swept clean roadside with no litter', 'a clean empty area next to a garbage bin'],
  WATER: ['a photo of a repaired water pipe with no leak', 'a dry road with no water leaking', 'clean water flowing from a tap'],
  ELECTRICITY: ['a photo of a working street light glowing', 'neatly installed electric wires on a pole', 'a new electric pole standing straight'],
  DRAINAGE: ['a photo of a clean open drain with flowing water', 'a dry street with no stagnant water', 'a closed manhole cover on a clean road'],
  GENERAL: ['a photo of a clean well maintained public place'],
};
const NOT_SITE_PROMPTS = ['a selfie of a person', 'a portrait photo of a face', 'a photo of the inside of a room', 'a screenshot or a document'];
const GENERIC_PROBLEM = ['a photo of a damaged or dirty public place', 'a broken civic facility on a street'];

// Calibrated on test photos (unrepaired pothole scored 0.03 "fixed"; repaired roads 0.32-0.61).
const SAME_PLACE_MIN = 0.5;
const FIXED_MIN = 0.25;
const PROBLEM_MAX = 0.75;
const IMPROVEMENT_MIN = 0.2;

async function verifyLocal({ beforePath, afterPath, category, department }) {
  const [before, after] = await Promise.all([localVision.embed(beforePath), localVision.embed(afterPath)]);
  const groups = {
    problem: localVision.PROMPTS[category] || GENERIC_PROBLEM,
    fixed: FIXED_PROMPTS[department] || FIXED_PROMPTS.GENERAL,
    notSite: NOT_SITE_PROMPTS,
  };
  const zAfter = await localVision.zeroShot(after, groups);
  const zBefore = await localVision.zeroShot(before, groups);
  const similarity = localVision.cosine(before, after);
  const improvement = zAfter.fixed - zBefore.fixed;

  const relevant = zAfter.notSite < 0.5;
  const samePlace = similarity >= SAME_PLACE_MIN;
  const fixed = zAfter.fixed >= FIXED_MIN && zAfter.problem <= PROBLEM_MAX && improvement >= IMPROVEMENT_MIN;

  const pct = (x) => Math.round(x * 100) + '%';
  let reason;
  if (!relevant) reason = `The completion photo looks like a person, room or document (${pct(zAfter.notSite)}), not the repair site.`;
  else if (!samePlace) reason = `The completion photo does not look like the same place as the citizen's photo (similarity ${pct(similarity)}, needs ${pct(SAME_PLACE_MIN)}).`;
  else if (!fixed) reason = `The problem still appears in the completion photo (problem ${pct(zAfter.problem)}, repaired ${pct(zAfter.fixed)}).`;
  else reason = `Same place (similarity ${pct(similarity)}) and the problem is no longer visible (repaired ${pct(zBefore.fixed)} → ${pct(zAfter.fixed)}).`;

  return {
    method: `Local AI model (${localVision.MODEL_ID}, offline)`,
    relevant, samePlace, fixed,
    similarity: Number(similarity.toFixed(3)),
    confidence: Number(zAfter.fixed.toFixed(3)),
    scores: {
      before: { problem: round(zBefore.problem), fixed: round(zBefore.fixed) },
      after: { problem: round(zAfter.problem), fixed: round(zAfter.fixed), notSite: round(zAfter.notSite) },
    },
    reason,
  };
}

const SCHEMA = {
  type: 'object',
  properties: {
    is_relevant_photo: { type: 'boolean' },
    same_location: { type: 'boolean' },
    problem_fixed: { type: 'boolean' },
    confidence: { type: 'number' },
    reason: { type: 'string' },
  },
  required: ['is_relevant_photo', 'same_location', 'problem_fixed', 'confidence', 'reason'],
  additionalProperties: false,
};

const SYSTEM = `You verify municipal repair work. Image 1 is the citizen's photo of a civic problem. Image 2 is the completion photo uploaded by the department after the repair.
Decide:
- is_relevant_photo: false if image 2 is a selfie, indoor room, document or otherwise not the repair site.
- same_location: true if both photos show the same place (same road, wall, pole, drain... allow different angle, time of day and zoom).
- problem_fixed: true only if the specific problem in image 1 is clearly repaired or cleaned in image 2.
- confidence: 0-1. reason: one short sentence.`;

async function verifyCloud({ beforePath, afterPath, beforeType, afterType, title, description }) {
  const r = await askVisionJSON({
    system: SYSTEM,
    schema: SCHEMA,
    parts: [
      { text: `Reported problem: "${title}" - ${description}` },
      { text: 'Image 1 (before, citizen photo):' },
      { image: { base64: fs.readFileSync(beforePath).toString('base64'), mediaType: beforeType } },
      { text: 'Image 2 (after, completion photo):' },
      { image: { base64: fs.readFileSync(afterPath).toString('base64'), mediaType: afterType } },
    ],
  });
  return {
    method: activeProvider().label,
    relevant: Boolean(r.is_relevant_photo),
    samePlace: Boolean(r.same_location),
    fixed: Boolean(r.problem_fixed),
    confidence: Math.max(0, Math.min(1, Number(r.confidence) || 0)),
    reason: r.reason,
  };
}

/**
 * issue: row from the issues table. after: { path, mediaType, latitude, longitude }.
 * Returns the full verdict; verified=true means the repair is accepted.
 */
async function verifyRepair({ issue, beforePath, beforeType, after }) {
  // 1. GPS check
  let gps;
  if (Number.isFinite(after.latitude) && Number.isFinite(after.longitude)) {
    const distance = Math.round(distanceMeters(issue.latitude, issue.longitude, after.latitude, after.longitude));
    gps = { ok: distance <= RESOLVE_RADIUS_M, distance, limit: RESOLVE_RADIUS_M };
  } else {
    gps = { ok: false, distance: null, limit: RESOLVE_RADIUS_M };
  }

  // 2-4. Photo checks
  let photo = null;
  if (activeProvider()) {
    try {
      photo = await verifyCloud({ beforePath, afterPath: after.path, beforeType, afterType: after.mediaType, title: issue.title, description: issue.description });
      const local = await verifyLocal({ beforePath, afterPath: after.path, category: issue.category, department: issue.department });
      photo.similarity = local.similarity;
    } catch (err) {
      console.warn('[verifier] Gemini failed, using local model:', err.message);
      photo = null;
    }
  }
  if (!photo) photo = await verifyLocal({ beforePath, afterPath: after.path, category: issue.category, department: issue.department });

  const verified = gps.ok && photo.relevant && photo.samePlace && photo.fixed;
  return { verified, gps, photo };
}

function round(x) { return Number(x.toFixed(3)); }

module.exports = { verifyRepair, RESOLVE_RADIUS_M };
