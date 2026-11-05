// Login / register page for citizens and department admins
(() => {
  // Already logged in? go straight to the right home page
  const u = Session.user;
  if (Session.token && u) location.href = u.role === 'admin' ? 'admin.html' : 'citizen.html';

  let role = 'citizen';
  let mode = 'login';
  let departments = [];
  const msg = document.getElementById('msg');
  const forms = {
    'citizen-login': document.getElementById('citizenLogin'),
    'citizen-register': document.getElementById('citizenRegister'),
    'admin-login': document.getElementById('adminLogin'),
    'admin-register': document.getElementById('adminRegister'),
  };
  const titles = {
    'citizen-login': ['auth.citizenLogin', 'auth.citizenLoginSub'],
    'citizen-register': ['auth.citizenRegister', 'auth.citizenRegisterSub'],
    'admin-login': ['auth.adminLogin', 'auth.adminLoginSub'],
    'admin-register': ['auth.adminRegister', 'auth.adminRegisterSub'],
  };

  function render() {
    const key = `${role}-${mode}`;
    Object.entries(forms).forEach(([k, f]) => f.classList.toggle('hidden', k !== key));
    document.getElementById('formTitle').textContent = t(titles[key][0]);
    document.getElementById('formSub').textContent = t(titles[key][1]);
    document.getElementById('switchLink').innerHTML = mode === 'login'
      ? `${esc(t('auth.newHere'))} <a id="toggle">${esc(t('auth.register'))}</a>`
      : `${esc(t('auth.already'))} <a id="toggle">${esc(t('auth.login'))}</a>`;
    document.getElementById('toggle').onclick = () => { mode = mode === 'login' ? 'register' : 'login'; msg.innerHTML = ''; render(); };
    document.querySelectorAll('#roleSeg button').forEach((b) => b.classList.toggle('active', b.dataset.role === role));
    renderDepartments();
  }

  function renderDepartments() {
    document.querySelectorAll('.dept-select').forEach((sel) => {
      const current = sel.value;
      sel.innerHTML = `<option value="">${esc(t('auth.selectDept'))}</option>` +
        departments.map((d) => `<option value="${d.code}">${esc(deptName(d.code))}</option>`).join('');
      sel.value = current;
    });
  }

  document.querySelectorAll('#roleSeg button').forEach((b) => b.addEventListener('click', () => { role = b.dataset.role; msg.innerHTML = ''; render(); }));
  document.addEventListener('langchange', render);

  api('/api/auth/departments').then((depts) => { departments = depts; renderDepartments(); });

  function show(type, text) { msg.innerHTML = `<div class="alert alert-${type}">${esc(text)}</div>`; }

  function submit(form, url, onSuccess) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = form.querySelector('button');
      setBusy(btn, true);
      try {
        const data = await api(url, { method: 'POST', body: Object.fromEntries(new FormData(form)) });
        setBusy(btn, false);
        onSuccess(data, form);
      } catch (err) { show('error', err.message); setBusy(btn, false); }
    });
  }

  const afterRegister = (data, form) => { form.reset(); mode = 'login'; render(); show('ok', data.message); };
  const afterLogin = (data) => { Session.save(data.token, data.user); location.href = data.user.role === 'admin' ? 'admin.html' : 'citizen.html'; };

  submit(forms['citizen-register'], '/api/auth/citizen/register', afterRegister);
  submit(forms['citizen-login'], '/api/auth/citizen/login', afterLogin);
  submit(forms['admin-register'], '/api/auth/admin/register', afterRegister);
  submit(forms['admin-login'], '/api/auth/admin/login', afterLogin);

  document.addEventListener('DOMContentLoaded', render);
  if (document.readyState !== 'loading') render();
})();
