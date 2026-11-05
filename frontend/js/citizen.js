// Citizen home: permissions, camera capture, AI analysis, voice input, submit, history
(() => {
  const user = requireRole('citizen');
  if (!user) return;
  document.getElementById('userName').textContent = '👤 ' + user.name;

  const $ = (id) => document.getElementById(id);
  const video = $('video'), preview = $('preview'), canvas = $('canvas');
  let stream = null;
  let position = null;
  let draftId = null;
  let lastAnalysis = null;
  let lastSuccess = null;
  let historyItems = null;
  const state = { gps: ['', 'cz.gpsWaiting'], cam: ['', 'cz.camWaiting'], loc: ['cz.locNone', {}] };

  // ---------------- Language ----------------
  $('voiceLang').value = Lang.current === 'te' ? 'te-IN' : 'en-IN';
  function renderDynamic() {
    $('gpsChip').className = 'chip ' + state.gps[0]; $('gpsChip').textContent = t(state.gps[1]);
    $('camChip').className = 'chip ' + state.cam[0]; $('camChip').textContent = t(state.cam[1]);
    $('locText').textContent = t(state.loc[0], state.loc[1]);
    if (lastAnalysis) renderAnalysis(lastAnalysis, false);
    if (lastSuccess) renderSuccess(lastSuccess);
    if (historyItems) renderHistory(historyItems);
  }
  document.addEventListener('langchange', () => {
    $('voiceLang').value = Lang.current === 'te' ? 'te-IN' : 'en-IN';
    renderDynamic();
  });

  // ---------------- Tabs ----------------
  document.querySelectorAll('.tab').forEach((tb) => tb.addEventListener('click', () => switchTab(tb.dataset.tab)));
  function switchTab(name) {
    document.querySelectorAll('.tab').forEach((tb) => tb.classList.toggle('active', tb.dataset.tab === name));
    $('tab-report').classList.toggle('hidden', name !== 'report');
    $('tab-history').classList.toggle('hidden', name !== 'history');
    if (name === 'history') loadHistory();
  }

  // ---------------- Permissions: GPS + camera ----------------
  function setState(key, value) { state[key] = value; renderDynamic(); }

  function requestGps() {
    if (!navigator.geolocation) return setState('gps', ['bad', 'cz.gpsUnsupported']);
    navigator.geolocation.watchPosition(
      (pos) => {
        position = { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: Math.round(pos.coords.accuracy) };
        state.loc = ['cz.locValue', { lat: position.lat.toFixed(6), lng: position.lng.toFixed(6), acc: position.acc }];
        setState('gps', ['ok', 'cz.gpsOn']);
        updatePermCard();
      },
      (err) => { state.loc = ['cz.locBlocked', { msg: err.message }]; setState('gps', ['bad', 'cz.gpsBlocked']); },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 }
    );
  }

  async function startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) { setState('cam', ['bad', 'cz.camUnsupported']); return; }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false });
      video.srcObject = stream;
      showCamera();
      setState('cam', ['ok', 'cz.camOn']);
      updatePermCard();
    } catch {
      setState('cam', ['bad', 'cz.camBlocked']);
      $('camPlaceholder').dataset.i18n = 'cz.camUnavailable';
      $('camPlaceholder').textContent = t('cz.camUnavailable');
    }
  }

  function updatePermCard() {
    if (state.gps[0] === 'ok' && state.cam[0] === 'ok') $('permBtn').classList.add('hidden');
  }

  $('permBtn').addEventListener('click', () => { requestGps(); startCamera(); });
  renderDynamic();
  requestGps();
  startCamera();

  // ---------------- Capture ----------------
  function showCamera() {
    video.classList.remove('hidden'); preview.classList.add('hidden'); $('camPlaceholder').classList.add('hidden');
    $('captureBtn').disabled = !stream; $('captureBtn').classList.remove('hidden'); $('retakeBtn').classList.add('hidden');
  }

  function showPreview(url) {
    preview.src = url; preview.classList.remove('hidden'); video.classList.add('hidden'); $('camPlaceholder').classList.add('hidden');
    $('captureBtn').classList.add('hidden'); $('retakeBtn').classList.remove('hidden');
  }

  // Draws any image source to a canvas (max 1280 px) and returns a JPEG blob
  function toJpeg(source, w, h) {
    const scale = Math.min(1, 1280 / Math.max(w, h));
    canvas.width = Math.round(w * scale); canvas.height = Math.round(h * scale);
    canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
  }

  $('captureBtn').addEventListener('click', async () => {
    if (!video.videoWidth) return toast(t('cz.cameraStarting'));
    const blob = await toJpeg(video, video.videoWidth, video.videoHeight);
    showPreview(URL.createObjectURL(blob));
    analyze(blob);
  });

  $('fileInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const img = new Image();
    img.onload = async () => {
      const blob = await toJpeg(img, img.naturalWidth, img.naturalHeight);
      showPreview(URL.createObjectURL(blob));
      analyze(blob);
    };
    img.onerror = () => toast(t('cz.imgUnsupported'));
    img.src = URL.createObjectURL(file);
    e.target.value = '';
  });

  $('retakeBtn').addEventListener('click', resetReport);

  function resetReport() {
    draftId = null;
    lastAnalysis = null;
    $('reportForm').reset();
    $('reportForm').classList.add('hidden'); $('aiLoading').classList.add('hidden'); $('aiError').classList.add('hidden');
    $('aiEmpty').classList.remove('hidden');
    if (stream) showCamera(); else { preview.classList.add('hidden'); $('camPlaceholder').classList.remove('hidden'); $('retakeBtn').classList.add('hidden'); }
  }

  // ---------------- AI analysis (feature 1) ----------------
  async function analyze(blob) {
    $('aiEmpty').classList.add('hidden'); $('aiError').classList.add('hidden'); $('reportForm').classList.add('hidden'); $('aiLoading').classList.remove('hidden');
    const form = new FormData();
    form.append('image', blob, 'issue.jpg');
    form.append('voiceText', $('voiceText').value);
    try {
      const data = await api('/api/citizen/analyze', { method: 'POST', form });
      draftId = data.draftId;
      renderAnalysis(data.analysis, true);
    } catch (err) {
      $('aiLoading').classList.add('hidden');
      $('aiError').classList.remove('hidden');
      $('aiError').innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
    }
  }

  function renderAnalysis(a, fillFields) {
    lastAnalysis = a;
    $('aiLoading').classList.add('hidden'); $('reportForm').classList.remove('hidden');
    $('aCategory').textContent = catName(a.category);
    $('aDept').textContent = deptName(a.department);
    const prio = a.visual_severity >= 8 ? 'Critical' : a.visual_severity >= 6 ? 'High' : a.visual_severity >= 4 ? 'Medium' : 'Low';
    $('aSeverity').innerHTML = `${severityBar(a.visual_severity, prio)} <b style="display:inline">${a.visual_severity}/10</b>`;
    $('aSeverity').title = a.severity_reason;
    $('aConf').textContent = Math.round(a.confidence * 100) + '%';
    if (fillFields) {
      $('title').value = a.title;
      $('description').value = a.description;
    }
    $('aiWarn').innerHTML = (!a.is_civic_issue ? `<div class="alert alert-warn">${esc(t('cz.notCivic'))}</div>` : '') +
      `<div class="muted small">${esc(t('cz.analysedBy', { provider: a.provider_label }))}</div>`;
    $('submitBtn').disabled = !a.is_civic_issue;
  }

  $('reanalyzeBtn').addEventListener('click', async () => {
    if (!draftId) return;
    if (!$('voiceText').value.trim()) return toast(t('cz.needVoice'));
    const btn = $('reanalyzeBtn');
    setBusy(btn, true, t('cz.aiUpdating'));
    try {
      const data = await api('/api/citizen/analyze', { method: 'POST', body: { draftId, voiceText: $('voiceText').value } });
      draftId = data.draftId;
      setBusy(btn, false);
      renderAnalysis(data.analysis, true);
    } catch (err) { toast(err.message); setBusy(btn, false); }
  });

  // ---------------- Speech recognition: Telugu / English ----------------
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognizer = null;
  let listening = false;
  if (!SR) { $('micBtn').disabled = true; $('noSpeech').classList.remove('hidden'); }

  $('micBtn').addEventListener('click', () => {
    if (!SR) return;
    if (listening) { recognizer.stop(); return; }
    recognizer = new SR();
    recognizer.lang = $('voiceLang').value;
    recognizer.continuous = true;
    recognizer.interimResults = true;
    const base = $('voiceText').value ? $('voiceText').value.trim() + ' ' : '';
    recognizer.onresult = (e) => {
      let text = '';
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
      $('voiceText').value = base + text;
    };
    recognizer.onerror = (e) => toast(t('cz.voiceError', { err: e.error }));
    recognizer.onend = () => { listening = false; $('micBtn').classList.remove('listening'); $('micBtn').textContent = '🎤'; };
    recognizer.start();
    listening = true;
    $('micBtn').classList.add('listening'); $('micBtn').textContent = '⏹';
    toast(t('cz.speakNow'));
  });

  // ---------------- Submit (features 2, 3, 4 run on the server) ----------------
  $('reportForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!position) return toast(t('cz.waitGps'));
    const btn = $('submitBtn');
    setBusy(btn, true, t('cz.submitting'));
    try {
      const data = await api('/api/citizen/issues', {
        method: 'POST',
        body: { draftId, title: $('title').value, description: $('description').value, voiceText: $('voiceText').value, latitude: position.lat, longitude: position.lng },
      });
      setBusy(btn, false);
      renderSuccess(data);
      $('successModal').classList.remove('hidden');
      resetReport();
      $('voiceText').value = '';
      historyItems = null;
    } catch (err) { toast(err.message, 5000); setBusy(btn, false); }
  });

  function renderSuccess(data) {
    lastSuccess = data;
    const i = data.issue;
    $('successText').textContent = data.merged ? t('cz.successMerged', { n: i.report_count }) : t('cz.successNew');
    $('successDetails').innerHTML = `
      <div class="kv" style="text-align:left">
        <b>${esc(t('cz.ticket'))}</b><span>#${i.id}</span>
        <b>${esc(t('cz.department'))}</b><span>${esc(deptName(i.department))}</span>
        <b>${esc(t('cz.severity'))}</b><span>${severityBar(i.severity, i.priority)} ${i.severity}/10 ${prioPill(i.priority)}</span>
        <b>${esc(t('cz.status'))}</b><span>${statusPill(i.status)}</span>
        ${i.area ? `<b>${esc(t('area.label'))}</b><span>${areaPill(i.area)} <span class="muted small">${esc(t('area.people', { n: i.area.citizens }))}</span></span>` : ''}
      </div>`;
  }

  $('newReportBtn').addEventListener('click', () => { $('successModal').classList.add('hidden'); lastSuccess = null; });
  $('viewHistoryBtn').addEventListener('click', () => { $('successModal').classList.add('hidden'); lastSuccess = null; switchTab('history'); });

  // ---------------- History ----------------
  $('refreshBtn').addEventListener('click', loadHistory);
  async function loadHistory() {
    const box = $('history');
    box.innerHTML = '<div class="empty"><span class="spinner"></span></div>';
    try {
      renderHistory(await api('/api/citizen/issues'));
    } catch (err) { box.innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`; }
  }

  function renderHistory(items) {
    historyItems = items;
    const box = $('history');
    if (!items.length) { box.innerHTML = `<div class="empty card" style="grid-column:1/-1">${esc(t('cz.noReports'))}</div>`; return; }
    const stepIndex = { Submitted: 1, 'In Progress': 2, Resolved: 3 };
    box.innerHTML = items.map((i) => `
      <article class="issue-card ${i.area ? 'area-' + i.area.color : ''}">
        ${i.resolution_image ? `
          <div class="ba" style="margin:0;padding:.5rem .5rem 0">
            <figure><img src="${media(i.my_image)}" alt="" loading="lazy"><figcaption>${esc(t('rp.before'))}</figcaption></figure>
            <figure><img src="${media(i.resolution_image)}" alt="" loading="lazy"><figcaption>${esc(t('rp.after'))}</figcaption></figure>
          </div>` : `<img src="${media(i.my_image)}" alt="" loading="lazy">`}
        <div class="body">
          <div class="meta"><b>${esc(i.my_title)}</b>${statusPill(i.status)}</div>
          ${i.resolution_image ? `<div class="small" style="color:var(--ok);font-weight:600">${esc(t('cz.repairVerified'))} · ${fmtDate(i.resolved_at)}</div>` : ''}
          ${i.area ? `<div class="small">${areaPill(i.area)} <span class="muted">${esc(t('area.people', { n: i.area.citizens }))}</span></div>` : ''}
          <div class="steps">${[1, 2, 3].map((s) => `<span class="${s <= stepIndex[i.status] ? 'on' : ''}"></span>`).join('')}</div>
          <div class="muted small">${esc(t('cz.stepsLabel'))}</div>
          <div class="meta"><span>${severityBar(i.severity, i.priority)} <b>${i.severity}/10</b></span>${prioPill(i.priority)}</div>
          <div class="small">🏢 ${esc(deptName(i.department))} · ${esc(t('cz.ticket'))} #${i.id} · ${esc(catName(i.category))}</div>
          ${i.report_count > 1 ? `<div class="small">${esc(t('cz.reportedBy', { n: i.report_count }))}${i.is_duplicate ? esc(t('cz.yoursMerged')) : ''}</div>` : ''}
          ${i.address ? `<div class="muted small">📍 ${esc(i.address)}</div>` : ''}
          <div class="muted small">🕒 ${fmtDate(i.reported_at)}</div>
        </div>
      </article>`).join('');
  }
})();
