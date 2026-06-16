import { loadMaps } from '../gmap.js';
import { getConfig, getOverride, setConfig, isConfigured, isUsingOverride, ping } from '../supa.js';
import { canBeDev, isDevMode, setDevMode } from '../dev-mode.js';
import { getLang, setLang, t } from '../i18n.js';
import { currentUser, updateProfile } from '../auth.js';

function attr(s) {
  return (s == null ? '' : String(s)).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

function maskHost(url) {
  try {
    const u = new URL(url);
    return u.host;
  } catch { return url; }
}

function privacyCard() {
  const me = currentUser();
  if (!me) return '';
  const priv = !!me.isPrivate;
  return (
    '<section class="settings-card">' +
      '<h2>' + t('settings.privacy.title') + ' <span class="settings-tag">' +
        (priv ? '🔒 ' + t('settings.privacy.private') : '🌐 ' + t('settings.privacy.public')) +
      '</span></h2>' +
      '<p class="settings__hint">' +
        (priv ? t('settings.privacy.hint_private') : t('settings.privacy.hint_public')) +
      '</p>' +
      '<div class="settings-form__actions">' +
        '<button type="button" class="btn btn--' + (priv ? 'ghost' : 'primary') + '" id="privacy-toggle">' +
          (priv ? '🌐 ' + t('settings.privacy.go_public') : '🔒 ' + t('settings.privacy.go_private')) +
        '</button>' +
      '</div>' +
      '<p class="settings-status" id="privacy-status"></p>' +
    '</section>' +
    audienceCard()
  );
}

// Edit the per-list audiences used by 「親しい友達」 and 「同じ組織」
// post visibilities. Both lists are curated handles — the user adds
// or removes names manually. The free-text `organization` field is
// kept as a profile label but no longer drives visibility matching.
function audienceCard() {
  const me = currentUser();
  if (!me) return '';
  const friends = Array.isArray(me.closeFriends) ? me.closeFriends.join(', ') : '';
  const orgMembers = Array.isArray(me.orgMembers) ? me.orgMembers.join(', ') : '';
  return (
    '<section class="settings-card">' +
      '<h2>' + t('settings.audience.title') + '</h2>' +
      '<p class="settings__hint">' + t('settings.audience.hint') + '</p>' +
      '<form class="settings-form" id="audience-form">' +
        '<label>' + t('settings.audience.friends') +
          '<input name="closeFriends" type="text" autocomplete="off" spellcheck="false" ' +
            'placeholder="alice, bob, carol" value="' + attr(friends) + '">' +
        '</label>' +
        '<label>' + t('settings.audience.org_members') +
          '<input name="orgMembers" type="text" autocomplete="off" spellcheck="false" ' +
            'placeholder="dave, erin, frank" value="' + attr(orgMembers) + '">' +
        '</label>' +
        '<label>' + t('settings.audience.org') +
          '<input name="organization" type="text" autocomplete="off" maxlength="80" ' +
            'placeholder="' + attr(t('settings.audience.org_placeholder')) + '" value="' + attr(me.organization || '') + '">' +
        '</label>' +
        '<div class="settings-form__actions">' +
          '<button type="submit" class="btn btn--primary">' + t('settings.audience.save') + '</button>' +
        '</div>' +
        '<p class="settings-status" id="audience-status"></p>' +
      '</form>' +
    '</section>'
  );
}

function userCards() {
  return (
    privacyCard() +
    '<section class="settings-card">' +
      '<h2>' + t('settings.map.title') + '</h2>' +
      '<p class="settings__hint">' + t('settings.map.hint') + '</p>' +
      '<div class="settings-form__actions">' +
        '<button type="button" class="btn btn--ghost" id="map-test">' + t('settings.map.test') + '</button>' +
      '</div>' +
      '<p class="settings-status" id="map-status">' + t('settings.status.unverified') + '</p>' +
    '</section>' +

    '<section class="settings-card">' +
      '<h2>' + t('settings.about.title') + '</h2>' +
      '<p class="settings__hint">' + t('settings.about.body') + '</p>' +
    '</section>'
  );
}

function devCards({ cfg, override, usingOverride }) {
  return (
    '<h2 class="settings__section">' + t('settings.dev.section') + '</h2>' +
    '<p class="settings__section-hint">' + t('settings.dev.section_hint') + '</p>' +

    '<section class="settings-card">' +
      '<h2>' + t('settings.dev.title') + ' <span class="settings-tag">' + (isDevMode() ? 'ON' : 'OFF') + '</span></h2>' +
      '<p class="settings__hint">' + t('settings.dev.hint') + '</p>' +
      '<div class="settings-form__actions">' +
        '<button type="button" class="btn btn--' + (isDevMode() ? 'ghost' : 'primary') + '" id="dev-mode-toggle">' +
          (isDevMode() ? t('settings.dev.on') : t('settings.dev.off')) +
        '</button>' +
      '</div>' +
    '</section>' +

    '<section class="settings-card">' +
      '<h2>' + t('settings.supa.title') +
        (isConfigured() ? ' <span class="settings-tag is-ok">' + t('settings.supa.connected') + '</span>'
                        : ' <span class="settings-tag">' + t('settings.supa.not_set') + '</span>') + '</h2>' +
      '<p class="settings__hint">' +
        (usingOverride ? t('settings.supa.hint_override') : t('settings.supa.hint_default')) +
      '</p>' +
      '<dl class="settings-kv">' +
        '<dt>Project URL</dt><dd><code>' + attr(maskHost(cfg.url)) + '</code></dd>' +
        '<dt>Mode</dt><dd>' +
          (usingOverride
            ? '<span class="settings-tag">' + t('settings.supa.mode_override') + '</span>'
            : '<span class="settings-tag is-ok">' + t('settings.supa.mode_default') + '</span>') +
        '</dd>' +
      '</dl>' +
      '<div class="settings-form__actions">' +
        '<button type="button" class="btn btn--ghost btn--sm" id="supa-test">' + t('settings.supa.test') + '</button>' +
        '<button type="button" class="btn btn--ghost btn--sm" id="supa-toggle-override">' +
          (usingOverride ? t('settings.supa.stop_override') : t('settings.supa.start_override')) +
        '</button>' +
      '</div>' +
      '<p class="settings-status" id="supa-status">' + t('settings.status.unverified') + '</p>' +

      '<form class="settings-form" id="supa-form" hidden>' +
        '<p class="settings__hint">' + t('settings.supa.howto') + '</p>' +
        '<label>Project URL' +
          '<input name="url" type="url" autocomplete="off" spellcheck="false" ' +
            'placeholder="https://xxxx.supabase.co" value="' + attr(override.url) + '">' +
        '</label>' +
        '<label>anon / publishable key' +
          '<input name="anonKey" type="password" autocomplete="off" spellcheck="false" ' +
            'placeholder="sb_publishable_…">' +
        '</label>' +
        '<div class="settings-form__actions">' +
          '<button type="submit" class="btn btn--primary">' + t('settings.supa.save') + '</button>' +
          (usingOverride
            ? '<button type="button" class="btn btn--ghost" id="supa-clear">' + t('settings.supa.clear') + '</button>'
            : '') +
        '</div>' +
      '</form>' +

      '<p class="settings__note">' + t('settings.supa.security_note') + '</p>' +
    '</section>'
  );
}

export function renderSettings() {
  const cfg = getConfig();
  const override = getOverride();
  const usingOverride = isUsingOverride();

  const lang = getLang();
  return (
    '<div class="settings">' +
      '<h1 class="settings__title">' + t('settings.title') + '</h1>' +

      '<section class="settings-card">' +
        '<h2>' + t('settings.lang.title') + '</h2>' +
        '<p class="settings__hint">' + t('settings.lang.hint') + '</p>' +
        '<div class="settings-form__actions">' +
          '<button type="button" class="btn btn--' + (lang === 'ja' ? 'primary' : 'ghost') + '" data-lang="ja">' + t('settings.lang.ja') + '</button>' +
          '<button type="button" class="btn btn--' + (lang === 'en' ? 'primary' : 'ghost') + '" data-lang="en">' + t('settings.lang.en') + '</button>' +
        '</div>' +
      '</section>' +

      userCards() +
      (canBeDev() ? devCards({ cfg, override, usingOverride }) : '') +
    '</div>'
  );
}

export function bindSettings() {
  // Map test
  const mapStatus = document.getElementById('map-status');
  const mapBtn    = document.getElementById('map-test');
  if (mapBtn && mapStatus) {
    const show = (t, k = '') => {
      mapStatus.textContent = t;
      mapStatus.className = 'settings-status' + (k ? ' is-' + k : '');
    };
    mapBtn.addEventListener('click', async () => {
      show(t('settings.map.loading'));
      try {
        await loadMaps();
        show(t('settings.map.ok'), 'ok');
      } catch (err) { show(t('settings.map.failed') + ': ' + err.message, 'bad'); }
    });
  }

  // Supabase
  const supaForm   = document.getElementById('supa-form');
  const supaStatus = document.getElementById('supa-status');
  const show = (t, k = '') => {
    if (!supaStatus) return;
    supaStatus.textContent = t;
    supaStatus.className = 'settings-status' + (k ? ' is-' + k : '');
  };

  document.getElementById('supa-toggle-override')?.addEventListener('click', () => {
    if (supaForm) supaForm.hidden = !supaForm.hidden;
  });

  supaForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(supaForm);
    const url = String(fd.get('url') || '').trim();
    const anonKey = String(fd.get('anonKey') || '').trim();
    if (!url || !anonKey) { show(t('settings.supa.err.missing'), 'bad'); return; }
    if (!/^https:\/\/.+\.supabase\.(co|in)/i.test(url)) {
      show(t('settings.supa.err.bad_url'), 'bad');
      return;
    }
    setConfig({ url, anonKey });
    show(t('settings.supa.saved'), 'ok');
    setTimeout(() => location.reload(), 400);
  });

  document.getElementById('supa-clear')?.addEventListener('click', () => {
    if (!confirm(t('settings.supa.confirm_clear'))) return;
    setConfig({ url: '', anonKey: '' });
    show(t('settings.supa.cleared'), 'ok');
    setTimeout(() => location.reload(), 400);
  });

  // Language switch — setLang() persists + triggers a hard reload so
  // every cached HTML fragment / modal template re-renders in the new
  // language without us having to track listeners.
  document.querySelectorAll('[data-lang]').forEach(btn => {
    btn.addEventListener('click', () => setLang(btn.getAttribute('data-lang')));
  });

  // Privacy toggle — flip is_private on the profile and reload so every
  // cached view picks up the new state (Follow/Request button text,
  // post visibility, etc).
  const privBtn    = document.getElementById('privacy-toggle');
  const privStatus = document.getElementById('privacy-status');
  privBtn?.addEventListener('click', async () => {
    if (!privBtn) return;
    const me = currentUser();
    if (!me) return;
    privBtn.disabled = true;
    if (privStatus) privStatus.textContent = t('settings.privacy.updating');
    try {
      await updateProfile({ isPrivate: !me.isPrivate });
      if (privStatus) {
        privStatus.textContent = t('settings.privacy.updated');
        privStatus.className = 'settings-status is-ok';
      }
      setTimeout(() => location.reload(), 400);
    } catch (ex) {
      if (privStatus) {
        privStatus.textContent = t('settings.privacy.failed') + ': ' + (ex.message || ex);
        privStatus.className = 'settings-status is-bad';
      }
      privBtn.disabled = false;
    }
  });

  // Audience form (close friends + organization) — Stage 16.
  const audienceForm = document.getElementById('audience-form');
  audienceForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const me = currentUser();
    if (!me) return;
    const fd = new FormData(audienceForm);
    // Both lists use the same parser — split on commas/whitespace,
    // strip a leading "@", drop empties, dedupe.
    const parseHandles = (raw) => [...new Set(String(raw || '').split(/[,\s]+/)
      .map(h => h.replace(/^@/, '').trim()).filter(Boolean))];
    const closeFriends = parseHandles(fd.get('closeFriends'));
    const orgMembers   = parseHandles(fd.get('orgMembers'));
    const organization = String(fd.get('organization') || '').trim();
    const status = document.getElementById('audience-status');
    if (status) status.textContent = t('settings.audience.saving');
    try {
      await updateProfile({ closeFriends, orgMembers, organization });
      if (status) {
        status.textContent = t('settings.audience.saved');
        status.className = 'settings-status is-ok';
      }
    } catch (ex) {
      if (status) {
        status.textContent = t('settings.audience.failed') + ': ' + (ex.message || ex);
        status.className = 'settings-status is-bad';
      }
    }
  });

  // Developer-mode toggle (only present when the current user is on the
  // allowlist — the button doesn't render otherwise).
  document.getElementById('dev-mode-toggle')?.addEventListener('click', () => {
    setDevMode(!isDevMode());
    location.reload();
  });

  document.getElementById('supa-test')?.addEventListener('click', async () => {
    show(t('settings.supa.testing'), '');
    try {
      await ping();
      show(t('settings.supa.test_ok'), 'ok');
    } catch (err) {
      const msg = err.message === 'NO_CONFIG' ? t('settings.supa.err.no_config')
                : err.message === 'AUTH_FAILED' ? t('settings.supa.err.auth_failed')
                : t('settings.supa.err.connect_failed') + ': ' + err.message;
      show(msg, 'bad');
    }
  });
}
