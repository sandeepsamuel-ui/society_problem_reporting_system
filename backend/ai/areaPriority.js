// Intelligent prioritization by area: how many different citizens reported problems of the
// same department within 1 km of an issue. The more people affected nearby, the hotter the colour:
//   🔴 red    - AREA_RED or more citizens within 1 km   (default 3+)
//   🟠 orange - AREA_ORANGE or more citizens             (default 2)
//   🟡 yellow - a single citizen
// Resolved issues have no area colour.
const db = require('../../db/database');
const { distanceMeters } = require('../services/geo');

const AREA_RADIUS_M = Number(process.env.AREA_RADIUS_M || 1000);
const AREA_RED = Number(process.env.AREA_RED || 3);
const AREA_ORANGE = Number(process.env.AREA_ORANGE || 2);
const RANK = { red: 0, orange: 1, yellow: 2 };

function colorFor(count) {
  if (count >= AREA_RED) return 'red';
  if (count >= AREA_ORANGE) return 'orange';
  return 'yellow';
}

/** Map of issueId -> { color, citizens, issuesNearby } for all open issues of a department. */
function areaPriorityFor(department) {
  const open = db.prepare(`SELECT id, latitude, longitude FROM issues WHERE department = ? AND status != 'Resolved'`).all(department);
  const reports = db.prepare(`
    SELECT r.citizen_id, r.latitude, r.longitude, r.issue_id
    FROM reports r JOIN issues i ON i.id = r.issue_id
    WHERE i.department = ? AND i.status != 'Resolved'`).all(department);

  const result = new Map();
  for (const issue of open) {
    const citizens = new Set();
    const nearbyIssues = new Set();
    for (const r of reports) {
      if (distanceMeters(issue.latitude, issue.longitude, r.latitude, r.longitude) <= AREA_RADIUS_M) {
        citizens.add(r.citizen_id);
        nearbyIssues.add(r.issue_id);
      }
    }
    result.set(issue.id, { color: colorFor(citizens.size), citizens: citizens.size, issuesNearby: nearbyIssues.size, radius: AREA_RADIUS_M });
  }
  return result;
}

/** Adds `area` to each issue object (must have id, department, status). */
function attachArea(issues) {
  const byDept = new Map();
  for (const issue of issues) {
    if (!byDept.has(issue.department)) byDept.set(issue.department, areaPriorityFor(issue.department));
    issue.area = issue.status === 'Resolved' ? null : byDept.get(issue.department).get(issue.id) || null;
  }
  return issues;
}

/** Sort: open first, then red -> orange -> yellow, then severity, then report count. */
function sortByPriority(issues) {
  return issues.sort((a, b) =>
    (a.status === 'Resolved') - (b.status === 'Resolved') ||
    (RANK[a.area?.color] ?? 3) - (RANK[b.area?.color] ?? 3) ||
    b.severity - a.severity ||
    b.report_count - a.report_count ||
    String(b.created_at).localeCompare(String(a.created_at)));
}

module.exports = { attachArea, sortByPriority, areaPriorityFor, AREA_RADIUS_M, AREA_RED, AREA_ORANGE };
