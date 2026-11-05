// AI FEATURES 3 + 4: Intelligent prioritization and multimodal severity scoring (1-10).
//
// final severity = AI visual severity (from the photo + voice note, feature 1's multimodal call)
//                + boost for how many citizens reported the same problem (from feature 2)
//                + boost for critical public facilities within 1 km (hospital, fire station, ...)
// capped at 10. The breakdown is stored so admins can see why an issue is critical.

const FACILITY_WEIGHTS = {
  hospital: 3,
  fire_station: 3,
  clinic: 1,
  police: 1,
  school: 1,
};

function reportBoost(count) {
  if (count >= 10) return 3;
  if (count >= 5) return 2;
  if (count >= 2) return 1;
  return 0;
}

function facilityBoost(facilities = []) {
  const kinds = new Set(facilities.map((f) => f.type));
  let boost = 0;
  for (const kind of kinds) boost += FACILITY_WEIGHTS[kind] || 0;
  return Math.min(boost, 3);
}

function priorityLabel(score) {
  if (score >= 8) return 'Critical';
  if (score >= 6) return 'High';
  if (score >= 4) return 'Medium';
  return 'Low';
}

function computeSeverity({ aiSeverity, reportCount, facilities, severityReason }) {
  const fromReports = reportBoost(reportCount);
  const fromFacilities = facilityBoost(facilities);
  const score = Math.max(1, Math.min(10, aiSeverity + fromReports + fromFacilities));

  const critical = facilities.filter((f) => FACILITY_WEIGHTS[f.type] >= 3);
  return {
    score,
    priority: priorityLabel(score),
    breakdown: {
      ai_visual_severity: aiSeverity,
      ai_reason: severityReason || null,
      report_count: reportCount,
      report_boost: fromReports,
      facility_boost: fromFacilities,
      critical_facilities_nearby: critical.map((f) => `${f.name} (${f.type.replace('_', ' ')}, ${f.distance} m)`),
    },
  };
}

module.exports = { computeSeverity, priorityLabel };
