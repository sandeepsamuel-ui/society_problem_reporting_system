// Geo helpers: distance, nearby critical facilities (OpenStreetMap Overpass) and reverse geocoding (Nominatim).
const USER_AGENT = 'CivicPulse/1.0 (municipal issue reporting demo)';
const FACILITY_RADIUS_M = 1000;
const cache = new Map();

function distanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

async function fetchWithTimeout(url, options = {}, ms = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: controller.signal, headers: { 'User-Agent': USER_AGENT, ...(options.headers || {}) } });
  } finally {
    clearTimeout(timer);
  }
}

const FACILITY_TYPES = ['hospital', 'fire_station', 'clinic', 'police', 'school'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function finalize(list, lat, lon) {
  const seen = new Set();
  return list
    .map((f) => ({ ...f, distance: Math.round(distanceMeters(lat, lon, f.lat, f.lon)) }))
    .filter((f) => f.distance <= FACILITY_RADIUS_M && !seen.has(f.type + f.name) && seen.add(f.type + f.name))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 15)
    .map(({ type, name, distance }) => ({ type, name, distance }));
}

// Primary source: Nominatim amenity search inside a ~1 km box (1 request/second per its usage policy).
async function viaNominatim(lat, lon) {
  const dLat = FACILITY_RADIUS_M / 111320;
  const dLon = dLat / Math.cos((lat * Math.PI) / 180);
  const viewbox = [lon - dLon, lat + dLat, lon + dLon, lat - dLat].map((n) => n.toFixed(6)).join(',');
  const found = [];
  for (const type of FACILITY_TYPES) {
    const res = await fetchWithTimeout(
      `https://nominatim.openstreetmap.org/search?amenity=${type}&viewbox=${viewbox}&bounded=1&format=jsonv2&limit=10`, {}, 8000);
    if (!res.ok) throw new Error('Nominatim HTTP ' + res.status);
    for (const r of await res.json()) {
      found.push({ type, name: r.name || type.replace('_', ' '), lat: Number(r.lat), lon: Number(r.lon) });
    }
    await sleep(1000);
  }
  return found;
}

// Fallback source: Overpass API.
async function viaOverpass(lat, lon) {
  const query = `[out:json][timeout:15];nwr["amenity"~"^(${FACILITY_TYPES.join('|')})$"](around:${FACILITY_RADIUS_M},${lat},${lon});out center 60;`;
  const res = await fetchWithTimeout('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'data=' + encodeURIComponent(query),
  }, 20000);
  if (!res.ok) throw new Error('Overpass HTTP ' + res.status);
  const data = await res.json();
  return data.elements
    .filter((el) => (el.lat ?? el.center?.lat) != null)
    .map((el) => ({
      type: el.tags.amenity,
      name: el.tags.name || el.tags['name:en'] || el.tags.amenity.replace('_', ' '),
      lat: el.lat ?? el.center.lat,
      lon: el.lon ?? el.center.lon,
    }));
}

/** Hospitals, fire stations, clinics, police stations and schools within 1 km. */
async function nearbyFacilities(lat, lon) {
  const key = `${lat.toFixed(3)},${lon.toFixed(3)}`;
  if (cache.has(key)) return cache.get(key);

  for (const source of [viaNominatim, viaOverpass]) {
    try {
      const facilities = finalize(await source(lat, lon), lat, lon);
      cache.set(key, facilities);
      return facilities;
    } catch (err) {
      console.warn(`[geo] facility lookup (${source.name}) failed:`, err.message);
    }
  }
  return [];
}

async function reverseGeocode(lat, lon) {
  try {
    const res = await fetchWithTimeout(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=17`,
      {},
      6000
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data.display_name || null;
  } catch {
    return null;
  }
}

module.exports = { distanceMeters, nearbyFacilities, reverseGeocode };
