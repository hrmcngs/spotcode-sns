// Login / Sign-up modal. Mounts itself on first open() and stays in the DOM.
import { register, login, fetchGithubProfile } from '../auth.js';
import { icon } from '../icons.js';
import { lockBodyScroll, unlockBodyScroll } from '../body-scroll-lock.js';
import { resolveLoginEmail, isAcceptableLoginEmail, reservedSignupReason } from '../login-aliases.js';

let rootEl = null;

// Shown when the user types a bare identifier that isn't a known
// alias. login-aliases.js's ALIASES map is the source of truth for
// what we accept without an `@`.
const BARE_EMAIL_REJECTED = 'メールアドレスを入力してください（@ を含めてください）';

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
          '<button type="button" class="btn btn--social btn--gh" data-social="github">' + icon('github', { size: 18, fill: true }) + 'Continue with GitHub</button>' +
        '</div>' +
        '<div class="auth-divider"><span>or</span></div>' +

        // login pane
        // For 1Password / iCloud Keychain / Google Password Manager
        // to recognise the form and offer save / autofill:
        //   - autocomplete="username" + "current-password" pair (the
        //     password manager looks for that exact pairing — even on
        //     an email-only login, "username" is what wins it).
        //   - explicit id on every field so the manager can remember
        //     which slot it filled.
        //   - inputmode="email" for the right iOS / Android keyboard
        //     and autocapitalize="off" so iOS doesn't capitalise
        //     "Hiro" inside a typed address.
        //   - method/action stub so iCloud Keychain treats the form
        //     as a real login (otherwise Safari sometimes ignores it).
        // `novalidate` keeps iOS/WKWebView from silently swallowing the
        // submit event when autofill has not committed a field value yet.
        // We validate below so every tap produces visible feedback.
        '<form class="auth-form" data-pane="login" method="post" action="#" novalidate>' +
          '<h2 id="auth-title">Log in</h2>' +
          // type="text" (not "email") so internal aliased identifiers
          // like `dev.test.account` are accepted at the field level —
          // login-aliases.js expands them before they hit Supabase,
          // which still receives a well-formed email. inputmode="email"
          // keeps the right mobile keyboard for the common case.
          '<label for="auth-login-email">Email' +
            '<input id="auth-login-email" type="text" name="email" required ' +
              'autocomplete="username" inputmode="email" autocapitalize="off" spellcheck="false">' +
          '</label>' +
          '<label for="auth-login-password">Password' +
            '<input id="auth-login-password" type="password" name="password" required ' +
              'autocomplete="current-password">' +
          '</label>' +
          '<button type="submit" class="btn btn--primary btn--block">Log in</button>' +
          '<p class="auth-error" data-error></p>' +
        '</form>' +

        // register pane
        // Sign-up: email is the username Supabase auth stores, so the
        // credential the password manager saves should be email+password.
        // Tag handle as autocomplete="off" so the manager doesn\'t save
        // handle+password (which couldn\'t log in via Supabase anyway).
        '<form class="auth-form" data-pane="register" hidden method="post" action="#">' +
          '<h2>Create your account</h2>' +
          '<label for="auth-reg-name">Display name' +
            '<input id="auth-reg-name" name="name" required maxlength="40" autocomplete="name">' +
          '</label>' +
          '<label for="auth-reg-handle">Handle <span class="hint">(profile URL: /your_handle)</span>' +
            '<input id="auth-reg-handle" name="handle" required ' +
              'pattern="[A-Za-z0-9_][A-Za-z0-9_-]{1,19}" placeholder="2〜20 文字 半角英数 _ -" ' +
              'autocomplete="off" autocapitalize="off" spellcheck="false">' +
          '</label>' +
          // Same type="text" relaxation as the login pane — internal
          // aliased identifiers (login-aliases.js) get expanded into a
          // valid email before Supabase ever sees them, so we don't
          // need the browser to enforce the format here.
          '<label for="auth-reg-email">Email' +
            '<input id="auth-reg-email" type="text" name="email" required ' +
              'autocomplete="email" inputmode="email" autocapitalize="off" spellcheck="false">' +
          '</label>' +
          '<label for="auth-reg-password">Password <span class="hint">(8 文字以上)</span>' +
            '<input id="auth-reg-password" type="password" name="password" required ' +
              'minlength="8" autocomplete="new-password">' +
          '</label>' +

          '<fieldset class="role-group">' +
            '<legend>Account type</legend>' +
            '<label class="role-opt"><input type="radio" name="kind" value="user" checked>' +
              '<span><b>個人 / Personal</b><small>個人アカウント (通常)</small></span></label>' +
            '<label class="role-opt"><input type="radio" name="kind" value="org">' +
              '<span><b>組織 / Organization</b><small>会社・学校・コミュニティのアカウント</small></span></label>' +
          '</fieldset>' +

          '<fieldset class="role-group">' +
            '<legend>Role</legend>' +
            '<label class="role-opt"><input type="radio" name="role" value="programmer" checked>' +
              '<span><b>Programmer</b><small>GitHub 連携が必須</small></span></label>' +
            '<label class="role-opt"><input type="radio" name="role" value="general">' +
              '<span><b>General</b><small>GitHub は任意</small></span></label>' +
          '</fieldset>' +

          '<label data-gh-row>GitHub username <span class="hint" data-gh-hint>(Programmer は必須)</span>' +
            '<input id="auth-reg-github" name="githubHandle" placeholder="octocat" pattern="[A-Za-z0-9-]{1,39}" ' +
              'autocomplete="off" autocapitalize="off" spellcheck="false">' +
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
    // closest() — not matches() — because the tap target is usually the
    // SVG icon inside the close button, not the button itself.
    if (e.target.closest('[data-close]')) { close(); return; }
    const tab = e.target.closest('.auth-tab');
    if (tab) { showTab(tab.dataset.tab); return; }

    const social = e.target.closest('[data-social]');
    if (social && social.dataset.social === 'github') {
      // Jump to register tab and prefill — no real OAuth without backend.
      showTab('register');
      const reg = rootEl.querySelector('[data-pane="register"]');
      reg.querySelector('input[name="githubHandle"]').focus();
      setError(reg, 'GitHub ユーザー名を入力すると公開プロフィールから情報を取り込みます。');
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
    if (form.dataset.busy === '1') return;
    setError(form, '');
    const fd = new FormData(form);
    const rawEmail = String(fd.get('email') || '').trim();
    const password = String(fd.get('password') || '');
    if (!rawEmail || !password) {
      setError(form, 'Email と Password を入力してください');
      return;
    }
    // Reject bare strings that aren't a known alias before Supabase
    // sees them — gives the user a clearer error than "invalid login
    // credentials".
    if (!isAcceptableLoginEmail(rawEmail)) {
      setError(form, BARE_EMAIL_REJECTED);
      return;
    }
    const submit = form.querySelector('button[type="submit"]');
    const originalLabel = submit?.textContent || 'Log in';
    form.dataset.busy = '1';
    if (submit) { submit.disabled = true; submit.textContent = 'ログイン中…'; }
    try {
      // Expand internal bare identifiers (e.g. dev.test.account →
      // dev.test.account@spotcode-sns.local) before calling Supabase.
      await login({ email: resolveLoginEmail(rawEmail), password });
      close();
    } catch (err) {
      setError(form, err.message || String(err));
    } finally {
      delete form.dataset.busy;
      if (submit) { submit.disabled = false; submit.textContent = originalLabel; }
    }
  });

  // Register submit
  reg.addEventListener('submit', async (e) => {
    e.preventDefault();
    setError(reg, '');
    const fd = new FormData(reg);
    const rawEmail = fd.get('email');
    if (!isAcceptableLoginEmail(rawEmail)) {
      setError(reg, BARE_EMAIL_REJECTED);
      return;
    }
    // Block any signup that would collide with the reserved brand
    // / QA identifiers (handle, alias key, or internal fake domain).
    // The login flow still accepts these — only NEW account creation
    // is gated.
    const reserved = reservedSignupReason({ email: rawEmail, handle: fd.get('handle') });
    if (reserved) {
      setError(reg, reserved);
      return;
    }
    try {
      await register({
        // Same alias expansion as login, so the same bare identifier
        // can be used to initially sign up an internal account.
        email: resolveLoginEmail(rawEmail),
        password: fd.get('password'),
        handle: fd.get('handle'),
        name: fd.get('name'),
        role: fd.get('role'),
        kind: fd.get('kind') || 'user',
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
  lockBodyScroll();
  setTimeout(() => rootEl.querySelector('[data-pane="' + tab + '"] input')?.focus(), 30);
}

export function close() {
  if (!rootEl || rootEl.hidden) return;
  rootEl.hidden = true;
  unlockBodyScroll();
}
