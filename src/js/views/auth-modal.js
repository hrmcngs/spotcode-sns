// Login / Sign-up modal. Mounts itself on first open() and stays in the DOM.
import { register, login, fetchGithubProfile } from '../auth.js';
import { icon } from '../icons.js';

let rootEl = null;

function template() {
  return (
    '<div class="modal" id="auth-modal" hidden>' +
      '<div class="modal__backdrop" data-close></div>' +
      '<div class="modal__card" role="dialog" aria-labelledby="auth-title">' +
        '<button class="modal__close" data-close aria-label="Close">' + icon('close', { size: 18 }) + '</button>' +
        '<div class="auth-tabs">' +
          '<button class="auth-tab is-active" data-tab="login">Log in</button>' +
          '<button class="auth-tab" data-tab="register">Sign up</button>' +
        '</div>' +

        '<div class="auth-social">' +
          '<button class="btn btn--social btn--gh" data-social="github">' + icon('github', { size: 18, fill: true }) + 'Continue with GitHub</button>' +
          '<button class="btn btn--social btn--ig" data-social="instagram" title="バックエンド未実装">' + icon('instagram', { size: 18 }) + 'Continue with Instagram</button>' +
        '</div>' +
        '<div class="auth-divider"><span>or</span></div>' +

        // login pane
        '<form class="auth-form" data-pane="login">' +
          '<h2 id="auth-title">Log in</h2>' +
          '<label>Email<input type="email" name="email" required autocomplete="email"></label>' +
          '<label>Password<input type="password" name="password" required autocomplete="current-password"></label>' +
          '<button type="submit" class="btn btn--primary btn--block">Log in</button>' +
          '<p class="auth-error" data-error></p>' +
        '</form>' +

        // register pane
        '<form class="auth-form" data-pane="register" hidden>' +
          '<h2>Create your account</h2>' +
          '<label>Display name<input name="name" required maxlength="40"></label>' +
          '<label>Handle <span class="hint">(profile URL: /your_handle)</span>' +
            '<input name="handle" required pattern="[A-Za-z0-9_]{2,20}" placeholder="2〜20 文字 半角英数_">' +
          '</label>' +
          '<label>Email<input type="email" name="email" required autocomplete="email"></label>' +
          '<label>Password <span class="hint">(8 文字以上)</span>' +
            '<input type="password" name="password" required minlength="8" autocomplete="new-password">' +
          '</label>' +

          '<fieldset class="role-group">' +
            '<legend>Role</legend>' +
            '<label class="role-opt"><input type="radio" name="role" value="programmer" checked>' +
              '<span><b>Programmer</b><small>GitHub 連携が必須</small></span></label>' +
            '<label class="role-opt"><input type="radio" name="role" value="general">' +
              '<span><b>General</b><small>GitHub は任意</small></span></label>' +
          '</fieldset>' +

          '<label data-gh-row>GitHub username <span class="hint" data-gh-hint>(Programmer は必須)</span>' +
            '<input name="githubHandle" placeholder="octocat" pattern="[A-Za-z0-9-]{1,39}">' +
            '<span class="gh-status" data-gh-status></span>' +
          '</label>' +

          '<button type="submit" class="btn btn--primary btn--block">Create account</button>' +
          '<p class="auth-error" data-error></p>' +
        '</form>' +

      '</div>' +
    '</div>'
  );
}

function showTab(name) {
  rootEl.querySelectorAll('.auth-tab').forEach(b => b.classList.toggle('is-active', b.dataset.tab === name));
  rootEl.querySelectorAll('[data-pane]').forEach(p => { p.hidden = p.dataset.pane !== name; });
  rootEl.querySelectorAll('[data-error]').forEach(e => { e.textContent = ''; });
}

function setError(form, msg) {
  const el = form.querySelector('[data-error]');
  if (el) el.textContent = msg || '';
}

function bindEvents() {
  rootEl.addEventListener('click', (e) => {
    if (e.target.matches('[data-close]')) close();
    const tab = e.target.closest('.auth-tab');
    if (tab) showTab(tab.dataset.tab);

    const social = e.target.closest('[data-social]');
    if (social) {
      if (social.dataset.social === 'instagram') {
        alert('Instagram 連携は OAuth サーバーが必要なため、現在は未対応です。\n（client_secret を静的サイトに置けないため）');
        return;
      }
      if (social.dataset.social === 'github') {
        // Jump to register tab and prefill — no real OAuth without backend.
        showTab('register');
        const reg = rootEl.querySelector('[data-pane="register"]');
        reg.querySelector('input[name="githubHandle"]').focus();
        setError(reg, 'GitHub ユーザー名を入力すると公開プロフィールから情報を取り込みます。');
      }
    }
  });

  // GitHub handle live-validate on blur, and prefill name from API.
  const reg = rootEl.querySelector('[data-pane="register"]');
  const ghInput = reg.querySelector('input[name="githubHandle"]');
  const ghStatus = reg.querySelector('[data-gh-status]');
  ghInput.addEventListener('blur', async () => {
    const h = ghInput.value.trim();
    if (!h) { ghStatus.textContent = ''; ghStatus.className = 'gh-status'; return; }
    ghStatus.textContent = '…';
    ghStatus.className = 'gh-status is-checking';
    const profile = await fetchGithubProfile(h);
    if (profile) {
      ghStatus.textContent = '✓ ' + (profile.name || profile.login);
      ghStatus.className = 'gh-status is-ok';
      const nameInput = reg.querySelector('input[name="name"]');
      if (!nameInput.value) nameInput.value = profile.name || profile.login;
    } else {
      ghStatus.textContent = '✗ not found';
      ghStatus.className = 'gh-status is-bad';
    }
  });

  // Toggle GitHub requirement based on role.
  reg.querySelectorAll('input[name="role"]').forEach(r => {
    r.addEventListener('change', () => {
      const isProg = reg.querySelector('input[name="role"]:checked').value === 'programmer';
      reg.querySelector('[data-gh-hint]').textContent = isProg ? '(Programmer は必須)' : '(任意)';
      ghInput.required = isProg;
    });
  });
  ghInput.required = true; // default role = programmer

  // Login submit
  rootEl.querySelector('[data-pane="login"]').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    setError(form, '');
    const fd = new FormData(form);
    try {
      await login({ email: fd.get('email'), password: fd.get('password') });
      close();
    } catch (err) { setError(form, err.message || String(err)); }
  });

  // Register submit
  reg.addEventListener('submit', async (e) => {
    e.preventDefault();
    setError(reg, '');
    const fd = new FormData(reg);
    try {
      await register({
        email: fd.get('email'),
        password: fd.get('password'),
        handle: fd.get('handle'),
        name: fd.get('name'),
        role: fd.get('role'),
        githubHandle: fd.get('githubHandle')?.trim() || null,
      });
      close();
    } catch (err) { setError(reg, err.message || String(err)); }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !rootEl.hidden) close();
  });
}

function mount() {
  if (rootEl) return;
  const host = document.createElement('div');
  host.innerHTML = template();
  document.body.appendChild(host.firstElementChild);
  rootEl = document.getElementById('auth-modal');
  bindEvents();
}

export function openAuth(tab = 'login') {
  mount();
  showTab(tab);
  rootEl.hidden = false;
  setTimeout(() => rootEl.querySelector('[data-pane="' + tab + '"] input')?.focus(), 30);
}

export function close() {
  if (rootEl) rootEl.hidden = true;
}
