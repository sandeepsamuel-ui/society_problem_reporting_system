// Shared helpers for all pages (load after config.js and i18n.js)

// Backend address: '' when the backend serves these pages, otherwise from js/config.js (Live Server).
const API_BASE = String(window.CIVICPULSE_API || '').replace(/\/+$/, '');

// Uploaded photos live on the backend, so prefix their /uploads/... paths with the backend address.
function media(p) {
  const url = p && String(p).startsWith('/uploads/') ? API_BASE + p : p;
  return esc(url);
}
const Session = {
  get token() { try { return localStorage.getItem('cp_token'); } catch { return null; } },
  get user() { try { return JSON.parse(localStorage.getItem('cp_user')); } catch { return null; } },
  save(token, user) { localStorage.setItem('cp_token', token); localStorage.setItem('cp_user', JSON.stringify(user)); },
  clear() { try { localStorage.removeItem('cp_token'); localStorage.removeItem('cp_user'); } catch { /* ignore */ } },
};

async function api(path, { method = 'GET', body, form } = {}) {
  const headers = { 'X-Lang': Lang.current };
  if (Session.token) headers.Authorization = 'Bearer ' + Session.token;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }

  let res;
  try {
    res = await fetch(API_BASE + path, { method, headers, body: payload });
  } catch {
    throw new Error(t('common.offline', { url: API_BASE || location.origin }));
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && Session.token && !path.startsWith('/api/chat')) { Session.clear(); location.href = 'index.html'; }
  if (!res.ok) throw new Error(data.error || 'Request failed (' + res.status + ')');
  return data;
}

function requireRole(role) {
  const user = Session.user;
  if (!Session.token || !user || user.role !== role) { location.href = 'index.html'; return null; }
  return user;
}

function logout() { Session.clear(); location.href = 'index.html'; }

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function toast(msg, ms = 3200) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

function severityBar(score, priority) {
  let html = `<span class="sev ${priority}" title="${score}/10">`;
  for (let i = 1; i <= 10; i++) html += `<i class="${i <= score ? 'on' : ''}"></i>`;
  return html + '</span>';
}

function statusPill(status) {
  return `<span class="status ${status.replace(' ', '-')}">${esc(t('status.' + status))}</span>`;
}

function prioPill(priority) {
  return `<span class="prio ${priority}">${esc(t('prio.' + priority))}</span>`;
}

// Red / orange / yellow area priority (citizens reporting within 1 km)
function areaPill(area, withCount = false) {
  if (!area) return '';
  const count = withCount ? ` · ${esc(t('area.people', { n: area.citizens }))}` : '';
  return `<span class="area ${area.color}" title="${esc(t('area.people', { n: area.citizens }))}">${esc(t('area.' + area.color))}${count}</span>`;
}

function catName(category) { return t('cat.' + category); }
function deptName(code) { return t('dept.' + code); }

function fmtDate(s) {
  if (!s) return '';
  const d = new Date(s.replace(' ', 'T') + 'Z');
  return d.toLocaleString(Lang.current === 'te' ? 'te-IN' : 'en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function setBusy(btn, busy, label) {
  if (busy) { btn.dataset.label = btn.innerHTML; btn.innerHTML = `<span class="spinner"></span> ${esc(label || t('common.wait'))}`; btn.disabled = true; }
  else { btn.innerHTML = btn.dataset.label || btn.innerHTML; btn.disabled = false; }
}
