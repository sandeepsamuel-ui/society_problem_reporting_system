// Floating help assistant (bottom-right) on every page. Load after i18n.js and common.js.
(() => {
  const STORE = 'cp_chat';
  let history = load();
  let chips = [];
  let busy = false;

  const root = document.createElement('div');
  root.className = 'cb';
  root.innerHTML = `
    <button class="cb-fab" type="button" aria-label=""><span class="cb-fab-icon">💬</span></button>
    <section class="cb-panel hidden" role="dialog" aria-modal="false">
      <header class="cb-head">
        <div class="cb-avatar">🤖</div>
        <div class="cb-titles"><b class="cb-title"></b><span class="cb-sub"></span></div>
        <button class="cb-icon cb-clear" type="button">🗑️</button>
        <button class="cb-icon cb-close" type="button">✕</button>
      </header>
      <div class="cb-body" aria-live="polite"></div>
      <div class="cb-chips"></div>
      <form class="cb-input">
        <button class="cb-mic" type="button">🎤</button>
        <input type="text" maxlength="500" autocomplete="off">
        <button class="cb-send" type="submit">➤</button>
      </form>
    </section>`;
  document.body.appendChild(root);

  const $ = (sel) => root.querySelector(sel);
  const panel = $('.cb-panel'), body = $('.cb-body'), input = $('.cb-input input');

  function load() { try { return JSON.parse(sessionStorage.getItem(STORE)) || []; } catch { return []; } }
  function save() { try { sessionStorage.setItem(STORE, JSON.stringify(history.slice(-30))); } catch { /* ignore */ } }

  function renderLabels() {
    $('.cb-fab').setAttribute('aria-label', t('bot.open'));
    $('.cb-fab').title = t('bot.open');
    $('.cb-title').textContent = t('bot.title');
    $('.cb-sub').textContent = t('bot.subtitle');
    $('.cb-clear').title = t('bot.clear');
    $('.cb-close').title = t('bot.close');
    input.placeholder = t('bot.placeholder');
    $('.cb-send').title = t('bot.send');
  }

  function format(text) {
    return esc(text).replace(/\n/g, '<br>');
  }

  function render() {
    body.innerHTML = history.map((m) => `<div class="cb-msg ${m.role}">${format(m.text)}</div>`).join('') +
      (busy ? `<div class="cb-msg bot cb-typing"><span></span><span></span><span></span></div>` : '');
    $('.cb-chips').innerHTML = chips.map((c) => `<button type="button" class="cb-chip">${esc(c)}</button>`).join('');
    $('.cb-chips').querySelectorAll('.cb-chip').forEach((b) => b.addEventListener('click', () => send(b.textContent)));
    body.scrollTop = body.scrollHeight;
  }

  async function welcome() {
    try {
      const data = await api('/api/chat/welcome');
      if (!history.length) { history.push({ role: 'bot', text: data.reply }); save(); }
      chips = data.suggestions || [];
    } catch { chips = []; }
    render();
  }

  async function send(text) {
    text = String(text || '').trim();
    if (!text || busy) return;
    const previous = history.slice(-6);
    history.push({ role: 'user', text });
    chips = [];
    busy = true;
    save(); render();
    try {
      const data = await api('/api/chat', { method: 'POST', body: { message: text, history: previous } });
      history.push({ role: 'bot', text: data.reply });
      chips = data.suggestions || [];
    } catch {
      history.push({ role: 'bot', text: t('bot.error') });
    }
    busy = false;
    save(); render();
  }

  function open() {
    panel.classList.remove('hidden');
    root.classList.add('open');
    if (!history.length || !chips.length) welcome(); else render();
    setTimeout(() => input.focus(), 50);
  }
  function close() { panel.classList.add('hidden'); root.classList.remove('open'); }

  $('.cb-fab').addEventListener('click', () => (panel.classList.contains('hidden') ? open() : close()));
  $('.cb-close').addEventListener('click', close);
  $('.cb-clear').addEventListener('click', () => { history = []; chips = []; save(); welcome(); });
  $('.cb-input').addEventListener('submit', (e) => { e.preventDefault(); const v = input.value; input.value = ''; send(v); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.classList.contains('hidden')) close(); });

  // Voice questions in Telugu or English (Chrome / Edge)
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const mic = $('.cb-mic');
  if (!SR) mic.classList.add('hidden');
  let rec = null;
  mic.addEventListener('click', () => {
    if (rec) { rec.stop(); return; }
    rec = new SR();
    rec.lang = Lang.current === 'te' ? 'te-IN' : 'en-IN';
    rec.interimResults = true;
    rec.onresult = (e) => { input.value = Array.from(e.results).map((r) => r[0].transcript).join(''); };
    rec.onend = () => { mic.classList.remove('listening'); rec = null; if (input.value.trim()) { const v = input.value; input.value = ''; send(v); } };
    rec.onerror = () => { mic.classList.remove('listening'); };
    mic.classList.add('listening');
    rec.start();
  });

  // Language switch: relabel, and refresh suggestion chips in the new language
  document.addEventListener('langchange', () => { renderLabels(); if (!panel.classList.contains('hidden')) welcome(); else chips = []; });

  renderLabels();
})();
