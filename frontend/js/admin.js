// Department admin dashboard: stats, issue list, details + status update, completion photo
// verification, heatmap, AI log
(() => {
  const user = requireRole('admin');
  if (!user) return;
  const $ = (id) => document.getElementById(id);
  $('userName').textContent = '👤 ' + user.name;

  const AREA_COLORS = { red: '#dc2626', orange: '#f97316', yellow: '#eab308' };
  const RESOLVE_RADIUS_M = 150;
  let map, heatLayer, markerLayer, detailMap;
  let activeTab = 'issues';
  let openIssueId = null;
  const cache = { stats: null, issues: null, ailog: null };

  function renderHeader() { $('deptName').textContent = deptName(user.department); }
  renderHeader();

  document.addEventListener('langchange', () => {
    renderHeader();
    if (cache.stats) renderStats(cache.stats);
    if (cache.issues) renderIssues(cache.issues);
    if (cache.ailog) renderAiLog(cache.ailog);
    if (openIssueId) openDetail(openIssueId);
  });

  // ---------------- Tabs ----------------
  document.querySelectorAll('.tab').forEach((tb) => tb.addEventListener('click', () => {
    activeTab = tb.dataset.tab;
    document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === tb));
    ['issues', 'heatmap', 'ailog'].forEach((name) => $('tab-' + name).classList.toggle('hidden', name !== activeTab));
    if (activeTab === 'heatmap') loadHeatmap();
    if (activeTab === 'ailog') loadAiLog();
  }));

  // ---------------- Stats ----------------
  async function loadStats() { renderStats(await api('/api/admin/stats')); }
  function renderStats(s) {
    cache.stats = s;
    $('stats').innerHTML = [
      ['ad.total', s.total, ''], ['ad.submitted', s.submitted, ''], ['ad.inProgress', s.inProgress, ''],
      ['ad.resolved', s.resolved, ''], ['ad.redZone', s.redZone, 'red-zone'], ['ad.critical', s.critical, 'crit'],
      ['ad.dupMerged', s.duplicatesMerged, ''], ['ad.verifiedRepairs', s.verifiedRepairs, 'ok'],
    ].map(([key, n, cls]) => `<div class="stat ${cls}"><b>${n}</b><span>${esc(t(key))}</span></div>`).join('');
  }

  // ---------------- Issue list ----------------
  async function loadIssues() {
    const qs = new URLSearchParams({ status: $('fStatus').value, priority: $('fPriority').value, area: $('fArea').value });
    $('rows').innerHTML = '<tr><td colspan="9" class="empty"><span class="spinner"></span></td></tr>';
    try { renderIssues(await api('/api/admin/issues?' + qs)); }
    catch (err) { $('rows').innerHTML = `<tr><td colspan="9"><div class="alert alert-error">${esc(err.message)}</div></td></tr>`; }
  }

  function renderIssues(items) {
    cache.issues = items;
    const rows = $('rows');
    if (!items.length) { rows.innerHTML = `<tr><td colspan="9" class="empty">${esc(t('ad.noIssues'))}</td></tr>`; return; }
    rows.innerHTML = items.map((i) => `
      <tr data-id="${i.id}" class="${i.area ? 'row-' + i.area.color : ''}">
        <td><img class="thumb" src="${media(i.image_path)}" alt=""></td>
        <td>#${i.id}</td>
        <td>${i.area ? `${areaPill(i.area)}<div class="muted small">${esc(t('area.people', { n: i.area.citizens }))}</div>` : (i.resolution_image ? '✅' : '-')}</td>
        <td><b>${esc(i.title)}</b><div class="muted small">${esc(catName(i.category))}${i.address ? ' · ' + esc(i.address.split(',').slice(0, 2).join(',')) : ''}</div></td>
        <td>${esc(i.reporter_name)}<div class="muted small">${esc(i.reporter_email)}</div></td>
        <td style="white-space:nowrap">${severityBar(i.severity, i.priority)} <b>${i.severity}</b><br>${prioPill(i.priority)}</td>
        <td>👥 ${i.report_count}</td>
        <td>${statusPill(i.status)}</td>
        <td class="small">${fmtDate(i.created_at)}</td>
      </tr>`).join('');
    rows.querySelectorAll('tr[data-id]').forEach((tr) => tr.addEventListener('click', () => openDetail(tr.dataset.id)));
  }

  $('fStatus').addEventListener('change', loadIssues);
  $('fPriority').addEventListener('change', loadIssues);
  $('fArea').addEventListener('change', loadIssues);
  $('refreshBtn').addEventListener('click', refreshAll);

  // ---------------- AI log ----------------
  async function loadAiLog() {
    $('aiRows').innerHTML = '<tr><td colspan="8" class="empty"><span class="spinner"></span></td></tr>';
    try { renderAiLog(await api('/api/admin/ai-log')); }
    catch (err) { $('aiRows').innerHTML = `<tr><td colspan="8"><div class="alert alert-error">${esc(err.message)}</div></td></tr>`; }
  }

  function renderAiLog(items) {
    cache.ailog = items;
    const rows = $('aiRows');
    if (!items.length) { rows.innerHTML = `<tr><td colspan="8" class="empty">${esc(t('ad.noAi'))}</td></tr>`; return; }
    rows.innerHTML = items.map((a) => `
      <tr ${a.issue_id ? `data-id="${a.issue_id}"` : ''}>
        <td><img class="thumb" src="${media(a.image_path)}" alt=""></td>
        <td>${a.id}</td>
        <td><b>${esc(catName(a.category))}</b> <span class="muted small">${Math.round((a.confidence || 0) * 100)}%</span>
          <div class="small">${esc(a.title)}</div>
          ${a.local_scores ? `<div class="muted small">${Object.entries(a.local_scores).map(([k, v]) => `${esc(catName(k))} ${Math.round(v * 100)}%`).join(' · ')}</div>` : ''}</td>
        <td class="small">${esc(a.provider_label)}${a.provider_error ? `<div class="muted">${esc(t('ad.cloudError'))}: ${esc(a.provider_error.slice(0, 80))}</div>` : ''}</td>
        <td>${a.visual_severity}/10</td>
        <td class="small">${a.is_duplicate ? `${esc(t('ad.merged'))} · ${esc(a.duplicate_reason || '')}` : a.issue_id ? esc(t('ad.newIssue')) : `<span class="muted">${esc(t('ad.notSubmitted'))}</span>`}</td>
        <td>${a.issue_id ? '#' + a.issue_id : '-'}</td>
        <td class="small">${fmtDate(a.created_at)}</td>
      </tr>`).join('');
    rows.querySelectorAll('tr[data-id]').forEach((tr) => tr.addEventListener('click', () => openDetail(tr.dataset.id)));
  }

  // ---------------- Repair verification helpers ----------------
  function checkLine(ok, label, detail) {
    return `<div><span class="ic">${ok ? '✅' : '❌'}</span><span><b>${esc(label)}</b>${detail ? ' · ' + esc(detail) : ''}</span></div>`;
  }

  function renderVerdict({ verified, gps, photo }) {
    return `
      <div class="checks">
        ${checkLine(gps.ok, t('rp.checkGps'), gps.distance == null ? t('rp.gpsMissing') : t('rp.gpsDist', { d: gps.distance, l: gps.limit }))}
        ${checkLine(photo.relevant, t('rp.checkRelevant'))}
        ${checkLine(photo.samePlace, t('rp.checkSame'), photo.similarity != null ? Math.round(photo.similarity * 100) + '%' : '')}
        ${checkLine(photo.fixed, t('rp.checkFixed'))}
      </div>
      <div class="muted small">🤖 ${esc(photo.method)}: ${esc(photo.reason)}</div>
      <div class="verdict ${verified ? 'ok' : 'bad'}">${esc(t(verified ? 'rp.verifiedTitle' : 'rp.rejectedTitle'))}</div>`;
  }

  function renderCheckHistory(checks) {
    if (!checks.length) return '';
    return `
      <h3 style="margin-top:1.5rem">${esc(t('rp.history', { n: checks.length }))}</h3>
      <div class="reports-list">${checks.map((c) => `
        <div class="check-item">
          <img src="${media(c.image_path)}" alt="">
          <div class="small" style="flex:1">
            <b>${c.verified ? '✅' : '❌'} ${esc(t(c.verified ? 'rp.verifiedTitle' : 'rp.rejectedTitle'))}</b>
            <div class="muted">${fmtDate(c.created_at)} · ${esc(t('rp.by', { name: c.admin_name }))}</div>
            ${c.details ? renderVerdict(c.details).replace(/<div class="verdict[\s\S]*$/, '') : ''}
            ${c.note ? `<div>📝 ${esc(c.note)}</div>` : ''}
          </div>
        </div>`).join('')}</div>`;
  }

  // Draws an image to a canvas (max 1280 px) and returns a JPEG blob
  function toJpeg(img) {
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 1280 / Math.max(img.naturalWidth, img.naturalHeight));
    canvas.width = Math.round(img.naturalWidth * scale); canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
  }

  function setupRepair(issue) {
    let blob = null;
    let pos = null;
    const gpsText = $('rpGps');

    if (navigator.geolocation) {
      gpsText.textContent = t('rp.gpsWaiting');
      navigator.geolocation.getCurrentPosition(
        (p) => {
          pos = { lat: p.coords.latitude, lng: p.coords.longitude, acc: Math.round(p.coords.accuracy) };
          gpsText.textContent = t('rp.gpsValue', { lat: pos.lat.toFixed(6), lng: pos.lng.toFixed(6), acc: pos.acc });
        },
        () => { gpsText.textContent = t('rp.gpsBlocked'); },
        { enableHighAccuracy: true, timeout: 20000, maximumAge: 10000 }
      );
    } else {
      gpsText.textContent = t('rp.gpsBlocked');
    }

    $('rpFile').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const img = new Image();
      img.onload = async () => {
        blob = await toJpeg(img);
        $('rpAfter').src = URL.createObjectURL(blob);
        $('rpAfter').classList.remove('hidden');
        $('rpResult').innerHTML = '';
      };
      img.onerror = () => toast(t('cz.imgUnsupported'));
      img.src = URL.createObjectURL(file);
    });

    $('rpVerify').addEventListener('click', async () => {
      if (!blob) return toast(t('rp.needPhoto'));
      const btn = $('rpVerify');
      setBusy(btn, true, t('rp.verifying'));
      const form = new FormData();
      form.append('image', blob, 'completion.jpg');
      if (pos) { form.append('latitude', pos.lat); form.append('longitude', pos.lng); }
      form.append('note', $('rpNote').value);
      try {
        const r = await api(`/api/admin/issues/${issue.id}/complete`, { method: 'POST', form });
        setBusy(btn, false);
        $('rpResult').innerHTML = renderVerdict(r);
        toast(r.message, 5000);
        refreshAll();
        if (r.verified) setTimeout(() => { if (openIssueId == issue.id) openDetail(issue.id); }, 2500);
      } catch (err) { toast(err.message, 5000); setBusy(btn, false); }
    });
  }

  // ---------------- Issue detail ----------------
  async function openDetail(id) {
    openIssueId = id;
    $('detailModal').classList.remove('hidden');
    $('detail').innerHTML = '<div class="empty"><span class="spinner"></span></div>';
    const i = await api('/api/admin/issues/' + id);
    const b = i.severity_breakdown || {};
    const resolvedVerified = i.status === 'Resolved' && i.resolution_image;

    $('detail').innerHTML = `
      <h2>#${i.id} · ${esc(i.title)}</h2>
      <div style="margin-bottom:1rem">${statusPill(i.status)} ${prioPill(i.priority)} ${areaPill(i.area, true)} <span class="muted small">· ${esc(catName(i.category))}</span></div>
      ${resolvedVerified ? `
        <div class="resolved-banner">${esc(t('rp.resolvedBanner', { d: fmtDate(i.resolved_at) }))}</div>
        <div class="ba">
          <figure><img src="${media(i.image_path)}" alt=""><figcaption>${esc(t('rp.before'))}</figcaption></figure>
          <figure><img src="${media(i.resolution_image)}" alt=""><figcaption>${esc(t('rp.after'))}</figcaption></figure>
        </div>` : ''}
      <div class="detail-grid">
        <div>
          <img class="main" src="${media(i.image_path)}" alt="">
          <div id="detailMap"></div>
          <a class="small" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${i.latitude},${i.longitude}">${esc(t('ad.directions'))}</a>
        </div>
        <div>
          <p>${esc(i.description)}</p>
          <div class="kv">
            <b>${esc(t('ad.location'))}</b><span>${esc(i.address || '')}<br><span class="muted small">${i.latitude.toFixed(6)}, ${i.longitude.toFixed(6)}</span></span>
            <b>${esc(t('ad.reported'))}</b><span>${fmtDate(i.created_at)}</span>
            <b>${esc(t('ad.citizenReports'))}</b><span>👥 ${i.report_count}</span>
            ${i.area ? `<b>${esc(t('area.label'))}</b><span>${areaPill(i.area)} ${esc(t('area.people', { n: i.area.citizens }))}</span>` : ''}
            <b>${esc(t('ad.classifiedBy'))}</b><span>${esc(i.ai_provider || '-')}${i.ai_confidence != null ? ' · ' + esc(t('ad.confident', { n: Math.round(i.ai_confidence * 100) })) : ''}</span>
          </div>

          <h3 style="margin-top:1rem">${esc(t('ad.aiSeverity', { n: i.severity }))} ${severityBar(i.severity, i.priority)}</h3>
          <div class="kv small">
            <b>${esc(t('ad.aiVisual'))}</b><span>${b.ai_visual_severity ?? '-'}/10${b.ai_reason ? ' · ' + esc(b.ai_reason) : ''}</span>
            <b>${esc(t('ad.multiReports'))}</b><span>+${b.report_boost ?? 0} (${esc(t('ad.citizensN', { n: b.report_count ?? 1 }))})</span>
            <b>${esc(t('ad.criticalPlaces'))}</b><span>+${b.facility_boost ?? 0}${b.critical_facilities_nearby?.length ? '<br>' + b.critical_facilities_nearby.map(esc).join('<br>') : ''}</span>
          </div>
          ${i.nearby_facilities.length ? `<details class="small"><summary>${esc(t('ad.facilities', { n: i.nearby_facilities.length }))}</summary>${i.nearby_facilities.map((f) => `${esc(f.name)}: ${esc(f.type.replace('_', ' '))}, ${f.distance} m`).join('<br>')}</details>` : ''}

          <h3 style="margin-top:1.2rem">${esc(t('ad.updateStatus'))}</h3>
          <select id="newStatus">${['Submitted', 'In Progress', 'Resolved'].map((s) => `<option value="${s}" ${s === i.status ? 'selected' : ''}>${esc(t('status.' + s))}</option>`).join('')}</select>
          <input id="statusNote" placeholder="${esc(t('ad.notePh'))}" style="margin-top:.5rem">
          <button class="btn btn-primary btn-block" id="saveStatus" style="margin-top:.6rem">${esc(t('ad.saveStatus'))}</button>
        </div>
      </div>

      ${i.status !== 'Resolved' ? `
        <section class="repair">
          <h3>${esc(t('rp.title'))}</h3>
          <div class="muted small">${esc(t('rp.sub', { m: RESOLVE_RADIUS_M }))}</div>
          <div class="ba">
            <figure><img src="${media(i.image_path)}" alt=""><figcaption>${esc(t('rp.before'))}</figcaption></figure>
            <figure><img id="rpAfter" class="hidden" alt=""><figcaption>${esc(t('rp.after'))}</figcaption></figure>
          </div>
          <div class="repair-pick">
            <label class="btn" style="margin:0">${esc(t('rp.choose'))}
              <input type="file" id="rpFile" accept="image/*" capture="environment" class="hidden">
            </label>
            <span class="small muted" id="rpGps"></span>
          </div>
          <input id="rpNote" placeholder="${esc(t('ad.notePh'))}">
          <button class="btn btn-primary btn-block" id="rpVerify" style="margin-top:.6rem">${esc(t('rp.verify'))}</button>
          <div id="rpResult"></div>
        </section>` : ''}

      ${renderCheckHistory(i.repair_checks || [])}

      <h3 style="margin-top:1.5rem">${esc(t('ad.reportsN', { n: i.reports.length }))}</h3>
      <div class="reports-list">${i.reports.map((r) => `
        <div class="report-item">
          <img src="${media(r.image_path)}" alt="">
          <div class="small"><b>${esc(r.citizen_name)}</b> <span class="muted">${esc(r.citizen_email)} · ${fmtDate(r.created_at)}</span>
            ${r.is_duplicate ? ` <span class="chip">${esc(t('ad.mergedDup'))}</span><div class="muted">🔁 ${esc(r.duplicate_reason || '')}${r.duplicate_method ? ' (' + esc(r.duplicate_method) + ')' : ''}</div>` : ''}
            <div>${esc(r.description)}</div>
            ${r.voice_text ? `<div class="muted">🎙️ “${esc(r.voice_text)}”</div>` : ''}
          </div>
        </div>`).join('')}</div>

      <h3 style="margin-top:1.5rem">${esc(t('ad.history'))}</h3>
      <div class="timeline small">${i.history.map((h) => `<div>${statusPill(h.status)} <b>${esc(h.changed_by)}</b> <span class="muted">${fmtDate(h.changed_at)}</span>${h.note ? '<br>' + esc(h.note) : ''}</div>`).join('')}</div>`;

    $('saveStatus').addEventListener('click', async () => {
      const btn = $('saveStatus');
      const status = $('newStatus').value;
      setBusy(btn, true, t('ad.saving'));
      try {
        await api(`/api/admin/issues/${i.id}/status`, { method: 'PATCH', body: { status, note: $('statusNote').value } });
        toast(t('ad.statusUpdated', { s: t('status.' + status) }));
        refreshAll();
        openDetail(i.id);
      } catch (err) { toast(err.message); setBusy(btn, false); }
    });

    if (i.status !== 'Resolved') setupRepair(i);

    if (detailMap) detailMap.remove();
    detailMap = L.map('detailMap').setView([i.latitude, i.longitude], 16);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(detailMap);
    L.marker([i.latitude, i.longitude]).addTo(detailMap);
    L.circle([i.latitude, i.longitude], { radius: 1000, color: AREA_COLORS[i.area?.color] || '#94a3b8', weight: 1, fillOpacity: 0.06 }).addTo(detailMap);
    setTimeout(() => detailMap.invalidateSize(), 150);
  }

  function closeModal() { $('detailModal').classList.add('hidden'); openIssueId = null; }
  $('closeModal').addEventListener('click', closeModal);
  $('detailModal').addEventListener('click', (e) => { if (e.target.id === 'detailModal') closeModal(); });

  // ---------------- Heatmap ----------------
  async function loadHeatmap() {
    const points = await api('/api/admin/heatmap');
    if (!map) {
      map = L.map('map').setView([17.385, 78.4867], 12); // default: Hyderabad
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap contributors' }).addTo(map);
    }
    setTimeout(() => map.invalidateSize(), 50);
    if (heatLayer) heatLayer.remove();
    if (markerLayer) markerLayer.remove();

    const open = points.filter((p) => p.status !== 'Resolved');
    heatLayer = L.heatLayer(open.map((p) => [p.latitude, p.longitude, Math.min(1, (p.severity * p.report_count) / 20)]), {
      radius: 35, blur: 25, maxZoom: 17,
    }).addTo(map);

    markerLayer = L.layerGroup(points.map((p) => L.circleMarker([p.latitude, p.longitude], {
      radius: 6 + Math.min(p.area?.citizens || 1, 6), color: '#fff', weight: 2, fillOpacity: .95,
      fillColor: p.status === 'Resolved' ? '#94a3b8' : AREA_COLORS[p.area?.color] || AREA_COLORS.yellow,
    }).bindTooltip(() => `#${p.id} ${esc(p.title)}<br>${p.area ? esc(t('area.' + p.area.color)) + ' · ' + esc(t('area.people', { n: p.area.citizens })) + '<br>' : ''}${esc(t('cz.severity'))} ${p.severity}/10 · ${esc(t('status.' + p.status))}`)
      .on('click', () => openDetail(p.id)))).addTo(map);

    if (points.length) map.fitBounds(L.latLngBounds(points.map((p) => [p.latitude, p.longitude])).pad(0.3), { maxZoom: 16 });
  }

  function refreshAll() {
    loadStats(); loadIssues();
    if (activeTab === 'heatmap') loadHeatmap();
    if (activeTab === 'ailog') loadAiLog();
  }

  refreshAll();
  setInterval(loadStats, 30000); // keep counters live
})();
