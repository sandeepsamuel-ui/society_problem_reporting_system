// Local, offline image AI using OpenAI's CLIP model (runs on this computer, no API key needed).
//  - classify(): zero-shot image classification into civic categories
//  - embed():    512-dim image fingerprint, used to detect duplicate photos
// The model (~90 MB) is downloaded once from Hugging Face into backend/models/.
const path = require('path');
const {
  env, AutoProcessor, AutoTokenizer, CLIPVisionModelWithProjection, CLIPTextModelWithProjection, RawImage,
} = require('@huggingface/transformers');

const MODEL_ID = process.env.LOCAL_VISION_MODEL || 'Xenova/clip-vit-base-patch32';
env.cacheDir = path.join(__dirname, '..', 'models');

// Several descriptions per category improve zero-shot accuracy.
const PROMPTS = {
  pothole: ['a photo of a pothole in a road', 'a road with deep potholes filled with water', 'broken asphalt with a large hole'],
  road_damage: ['a photo of a cracked and damaged road surface', 'a broken road with loose gravel and debris', 'a road caved in and collapsed'],
  traffic_signal: ['a close-up photo of a broken traffic signal light', 'a bent and fallen traffic sign board'],
  garbage_dump: ['a photo of a pile of garbage dumped on the street', 'plastic waste and litter scattered on the roadside', 'a heap of trash in an empty plot'],
  overflowing_bin: ['a photo of an overflowing garbage bin', 'a full dustbin with trash spilling out'],
  dead_animal: ['a photo of a dead animal lying on the road'],
  water_leak: ['a photo of water leaking from a burst pipe', 'a broken water pipeline spraying water on the street', 'a leaking water tap wasting water'],
  no_water_supply: ['a photo of people waiting with empty water pots', 'a dry empty water tap'],
  contaminated_water: ['a photo of dirty muddy drinking water in a glass or bucket', 'contaminated brown tap water'],
  streetlight_fault: ['a photo of a broken street light pole', 'a street lamp that is not working', 'a damaged lamp post'],
  fallen_power_line: ['a photo of fallen electric power lines on the road', 'dangling tangled electrical wires hanging from a pole', 'a broken electric pole'],
  transformer_issue: ['a photo of an electrical transformer on a pole', 'a burning or sparking electrical transformer'],
  blocked_drain: ['a photo of a clogged drain blocked with garbage', 'a choked open drainage canal full of plastic'],
  sewage_overflow: ['a photo of black sewage overflowing from a drain', 'dirty black sewage water flowing on the street', 'foul sewage water coming out of a manhole cover'],
  waterlogging: ['a photo of a flooded street with stagnant rain water', 'a waterlogged road after heavy rain'],
  _not_civic: ['a selfie of a person', 'a photo of the inside of a house', 'a photo of food on a plate', 'a screenshot or a document', 'a photo of a pet', 'a clean well maintained road'],
};

let loading = null;
let parts = null;

async function load() {
  if (parts) return parts;
  if (!loading) {
    loading = (async () => {
      const t0 = Date.now();
      const [processor, tokenizer, vision, text] = await Promise.all([
        AutoProcessor.from_pretrained(MODEL_ID),
        AutoTokenizer.from_pretrained(MODEL_ID),
        CLIPVisionModelWithProjection.from_pretrained(MODEL_ID, { dtype: 'q8' }),
        CLIPTextModelWithProjection.from_pretrained(MODEL_ID, { dtype: 'q8' }),
      ]);

      // One text embedding per list of prompts: the average of its prompts ("prompt ensembling").
      const encodePrompts = async (prompts) => {
        const tokens = tokenizer(prompts, { padding: true, truncation: true });
        const { text_embeds } = await text(tokens);
        const rows = toRows(text_embeds).map(normalize);
        const mean = rows[0].map((_, i) => rows.reduce((s, r) => s + r[i], 0) / rows.length);
        return normalize(mean);
      };

      const labels = Object.keys(PROMPTS);
      const textVectors = [];
      for (const category of labels) textVectors.push(await encodePrompts(PROMPTS[category]));

      parts = { processor, vision, labels, textVectors, encodePrompts };
      console.log(`[local-ai] CLIP model ready in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
      return parts;
    })().catch((err) => { loading = null; throw err; });
  }
  return loading;
}

// Cached text vector for any list of prompts (used by the repair verifier).
const promptCache = new Map();
async function promptVector(prompts) {
  const key = prompts.join('|');
  if (!promptCache.has(key)) {
    const { encodePrompts } = await load();
    promptCache.set(key, await encodePrompts(prompts));
  }
  return promptCache.get(key);
}

/** Zero-shot: probability of each named prompt group for an image embedding. groups: { name: [prompts] } */
async function zeroShot(embedding, groups) {
  const names = Object.keys(groups);
  const logits = [];
  for (const name of names) logits.push(100 * dot(embedding, await promptVector(groups[name])));
  const max = Math.max(...logits);
  const exps = logits.map((l) => Math.exp(l - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return Object.fromEntries(names.map((n, i) => [n, exps[i] / sum]));
}

async function embed(imagePath) {
  const { processor, vision } = await load();
  const image = await RawImage.read(imagePath);
  const inputs = await processor(image);
  const { image_embeds } = await vision(inputs);
  return normalize(toRows(image_embeds)[0]);
}

/** Returns { category, confidence, isCivic, scores, embedding } */
async function classify(imagePath) {
  const { labels, textVectors } = await load();
  const embedding = await embed(imagePath);

  // CLIP zero-shot: softmax over cosine similarities scaled by CLIP's logit scale (100).
  const logits = textVectors.map((t) => 100 * dot(embedding, t));
  const max = Math.max(...logits);
  const exps = logits.map((l) => Math.exp(l - max));
  const sum = exps.reduce((a, b) => a + b, 0);

  const scores = {};
  exps.forEach((e, i) => { scores[labels[i]] = e / sum; });

  const notCivic = scores._not_civic || 0;
  const ranked = Object.entries(scores).filter(([k]) => k !== '_not_civic').sort((a, b) => b[1] - a[1]);
  const [category, prob] = ranked[0];
  return {
    category,
    confidence: Number((prob / Math.max(1e-6, 1 - notCivic)).toFixed(3)), // confidence among civic categories
    isCivic: notCivic < 0.5,
    scores: Object.fromEntries(ranked.slice(0, 4).map(([k, v]) => [k, Number(v.toFixed(3))])),
    embedding,
  };
}

function cosine(a, b) {
  return dot(a, b); // vectors are already normalized
}

function toRows(tensor) {
  const [rows, cols] = tensor.dims;
  const data = Array.from(tensor.data);
  return Array.from({ length: rows }, (_, r) => data.slice(r * cols, (r + 1) * cols));
}
function normalize(v) {
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / n);
}
function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

module.exports = { classify, embed, cosine, load, zeroShot, promptVector, PROMPTS, MODEL_ID };
