// AI FEATURE 1: Automated image classification.
// Looks at the citizen's photo (+ optional Telugu/English voice note), decides
// what the problem is, routes it to a department, writes the title and
// description, and gives a visual severity estimate used by feature 4.
//
// Provider chain: Google Gemini (if GEMINI_API_KEY is set) -> local CLIP model (always available, no key).
// The local CLIP model also produces an image fingerprint used for duplicate detection.
const fs = require('fs');
const { askVisionJSON, activeProvider } = require('./llm');
const localVision = require('./localVision');

const CATEGORIES = {
  pothole: 'ROADS',
  road_damage: 'ROADS',
  traffic_signal: 'ROADS',
  garbage_dump: 'GARBAGE',
  overflowing_bin: 'GARBAGE',
  dead_animal: 'GARBAGE',
  water_leak: 'WATER',
  no_water_supply: 'WATER',
  contaminated_water: 'WATER',
  streetlight_fault: 'ELECTRICITY',
  fallen_power_line: 'ELECTRICITY',
  transformer_issue: 'ELECTRICITY',
  blocked_drain: 'DRAINAGE',
  sewage_overflow: 'DRAINAGE',
  waterlogging: 'DRAINAGE',
  other: 'GENERAL',
};

const SCHEMA = {
  type: 'object',
  properties: {
    is_civic_issue: { type: 'boolean' },
    category: { type: 'string', enum: Object.keys(CATEGORIES) },
    title: { type: 'string' },
    description: { type: 'string' },
    visual_severity: { type: 'integer' },
    severity_reason: { type: 'string' },
    confidence: { type: 'number' },
  },
  required: ['is_civic_issue', 'category', 'title', 'description', 'visual_severity', 'severity_reason', 'confidence'],
  additionalProperties: false,
};

const SYSTEM = `You are the intake officer of an Indian municipal corporation's civic grievance system.
Citizens send a photo of a problem in their neighbourhood, sometimes with a voice note in Telugu or English.

Decide:
- is_civic_issue: false if the photo does not show a public civic problem (selfie, indoor object, blank image).
- category: the single best category from the allowed list. Use "other" only if none of the specific categories fits.
- title: short English title, at most 8 words (e.g. "Large pothole on main road").
- description: 2-3 English sentences describing what is visible, its likely impact on the public, and anything the voice note adds. If the voice note is in Telugu, translate its meaning into English.
- visual_severity: integer 1-10 judged from the photo alone. 1-3 cosmetic or minor; 4-6 causes inconvenience; 7-8 risk of injury, disease or property damage; 9-10 immediate danger to life (exposed live wires, open manhole on a road, major flooding, sewage entering drinking water).
- severity_reason: one sentence explaining the score.
- confidence: 0 to 1, how sure you are of the category.`;

// ---------- Local (offline) report writing ----------
const LOCAL_INFO = {
  pothole: ['Pothole on the road', 6, 'A pothole has formed on the road surface. It can damage vehicles and cause two-wheeler accidents, especially at night or when filled with rain water.'],
  road_damage: ['Damaged road surface', 5, 'The road surface is cracked and broken. It slows traffic and is a risk for two-wheelers and pedestrians.'],
  traffic_signal: ['Traffic signal / sign damaged', 6, 'A traffic signal or road sign is damaged or not working, which creates confusion and a risk of collisions at the junction.'],
  garbage_dump: ['Garbage dumped on the street', 5, 'Garbage has been dumped in a public place. It causes foul smell, attracts stray animals and mosquitoes and is a health risk for residents.'],
  overflowing_bin: ['Overflowing garbage bin', 4, 'A public garbage bin is full and overflowing on to the street. It needs to be cleared to prevent smell and disease.'],
  dead_animal: ['Dead animal on the road', 6, 'A dead animal is lying in a public place. It must be removed quickly to prevent disease and foul smell.'],
  water_leak: ['Water pipeline leakage', 6, 'Drinking water is leaking from a pipeline, wasting water and damaging the road. Supply pressure to nearby homes may be affected.'],
  no_water_supply: ['No water supply in the area', 6, 'Residents report that drinking water is not being supplied in this area.'],
  contaminated_water: ['Contaminated drinking water', 8, 'The supplied water appears dirty or contaminated. Drinking it can cause water-borne diseases.'],
  streetlight_fault: ['Streetlight not working', 4, 'A streetlight is damaged or not working, leaving the street dark and unsafe at night.'],
  fallen_power_line: ['Dangerous electric wires', 9, 'Electric wires are hanging low, tangled or fallen. This is a serious electrocution risk for people and animals.'],
  transformer_issue: ['Electrical transformer problem', 7, 'A transformer on the electricity network appears faulty, which may cause power cuts, sparks or fire.'],
  blocked_drain: ['Blocked drain', 5, 'A drain is choked with waste, so water cannot flow. It can overflow during rain and breed mosquitoes.'],
  sewage_overflow: ['Sewage overflowing on the street', 7, 'Sewage is overflowing into a public area, creating a strong health hazard and foul smell.'],
  waterlogging: ['Waterlogging on the road', 6, 'Water has collected on the road and is not draining. It blocks traffic, hides potholes and breeds mosquitoes.'],
  other: ['Civic issue reported', 4, 'A civic problem has been reported by a citizen at this location.'],
};

// Checked in order; the most specific problems come first. Includes Telugu script and
// Telugu typed in English letters (e.g. "gunta", "chetta", "neellu").
const VOICE_KEYWORDS = [
  [/fallen wire|live wire|wire|shock|current teega|వైర్|కరెంట్ తీగ|తీగలు/i, 'fallen_power_line'],
  [/transformer|ట్రాన్స్‌ఫార్మర్/i, 'transformer_issue'],
  [/street ?light|lamp|light|లైట్|దీపం|వీధి దీపం/i, 'streetlight_fault'],
  [/sewage|manhole|muruguneeru|మురుగు|మ్యాన్‌హోల్/i, 'sewage_overflow'],
  [/leak|burst|pipe|lekage|పైపు|లీక్/i, 'water_leak'],
  [/dirty water|contaminat|మురికి నీరు|కలుషిత/i, 'contaminated_water'],
  [/no water|water supply|neellu raavatledu|నీళ్ళు రావడం లేదు|నీరు రావడం లేదు|నీటి సరఫరా/i, 'no_water_supply'],
  [/flood|water ?logging|stagnant|వరద|నీరు నిలిచి|నీళ్ళు నిలిచి/i, 'waterlogging'],
  [/drain|kaluva|కాలువ|డ్రైనేజీ/i, 'blocked_drain'],
  [/dead (dog|cow|animal)|చనిపోయిన/i, 'dead_animal'],
  [/dustbin|bin full|overflowing bin|డస్ట్‌బిన్/i, 'overflowing_bin'],
  [/garbage|trash|rubbish|litter|chetta|చెత్త|వ్యర్థాలు/i, 'garbage_dump'],
  [/pothole|gunta|guntha|goyyi|గుంత|గుంటలు|గొయ్యి/i, 'pothole'],
  [/signal|traffic light|సిగ్నల్/i, 'traffic_signal'],
  [/road|rasta|రోడ్డు|రహదారి/i, 'road_damage'],
];
const URGENT = /danger|accident|urgent|children|school|hospital|injur|pramadam|ప్రమాదం|అత్యవసర|పిల్లలు/i;

function localReport(local, voiceText = '') {
  let category = local ? local.category : 'other';
  let confidence = local ? local.confidence : 0;
  let source = 'image';

  // The citizen's own words are strong evidence: unless the photo is very clear, trust a keyword in the voice note.
  const voiceMatch = VOICE_KEYWORDS.find(([re]) => re.test(voiceText));
  if (voiceMatch && voiceMatch[1] !== category && (!local || confidence < 0.7)) {
    category = voiceMatch[1];
    confidence = Math.max(confidence, 0.6);
    source = 'voice note';
  }

  const [title, baseSeverity, text] = LOCAL_INFO[category];
  const urgent = URGENT.test(voiceText);
  const severity = Math.min(10, baseSeverity + (urgent ? 1 : 0));
  const note = voiceText.trim() ? ` Citizen's note: "${voiceText.trim()}"` : '';
  return {
    is_civic_issue: local ? local.isCivic || Boolean(voiceMatch) : true,
    category,
    title,
    description: text + note,
    visual_severity: severity,
    severity_reason: `Typical risk level for ${category.replace(/_/g, ' ')} (identified from the ${source})${urgent ? ', raised because the citizen reported urgency' : ''}.`,
    confidence: Number(confidence.toFixed(2)),
  };
}

// ---------- Main entry ----------
async function classifyIssue({ imagePath, mediaType, voiceText = '' }) {
  // Always run the local model: it gives the image fingerprint for duplicate detection
  // and is the fallback classifier.
  let local = null;
  try {
    local = await localVision.classify(imagePath);
  } catch (err) {
    console.warn('[classifier] local model failed:', err.message);
  }

  let result = null;
  let provider = 'local';
  let providerLabel = `Local AI model (${localVision.MODEL_ID}, offline)`;
  let error = null;

  const cloud = activeProvider();
  if (cloud) {
    try {
      const note = voiceText.trim() ? `Citizen's voice note (may be Telugu or English): "${voiceText.trim()}"` : 'No voice note was provided.';
      result = await askVisionJSON({
        system: SYSTEM,
        schema: SCHEMA,
        parts: [
          { image: { base64: fs.readFileSync(imagePath).toString('base64'), mediaType } },
          { text: `${note}\n\nAnalyse the photo and fill in every field.` },
        ],
      });
      if (!CATEGORIES[result.category]) result.category = 'other';
      result.visual_severity = Math.max(1, Math.min(10, Math.round(Number(result.visual_severity) || 5)));
      result.confidence = Math.max(0, Math.min(1, Number(result.confidence) || 0));
      provider = cloud.name;
      providerLabel = cloud.label;
    } catch (err) {
      error = err.message;
      console.warn(`[classifier] ${cloud.name} failed, using local model:`, err.message);
      result = null;
    }
  }

  if (!result) result = localReport(local, voiceText);

  return {
    ...result,
    department: CATEGORIES[result.category] || 'GENERAL',
    provider,
    provider_label: providerLabel,
    provider_error: error,
    local_scores: local ? local.scores : null,
    embedding: local ? local.embedding : null,
  };
}

module.exports = { classifyIssue, CATEGORIES };
