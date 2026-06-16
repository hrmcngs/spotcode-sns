import { loadMaps } from '../gmap.js';
import { getConfig, getOverride, setConfig, isConfigured, isUsingOverride, ping } from '../supa.js';
import { canBeDev, isDevMode, setDevMode } from '../dev-mode.js';
import { getLang, setLang, t } from '../i18n.js';
import { currentUser, updateProfile } from '../auth.js';
import { icon } from '../icons.js';
import { renderAvatar } from '../avatar.js';
import { getUser } from '../data.js';
import { searchProfiles, fetchProfileByHandle } from '../profiles.js';
import { debounce } from '../drafts.js';
import { hydrateMyFollows, myFollowingHandles } from '../interactions.js';

// In-memory state for the two audience-list editors so add/remove
// can re-render without a round trip. Initialised in renderSettings()
// from currentUser(); each edit immediately POSTs via updateProfile.
const audienceState = { closeFriends: [], orgMembers: [] };

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
        icon(priv ? 'lock' : 'globe', { size: 12, className: 'icon--inline' }) +
        (priv ? t('settings.privacy.private') : t('settings.privacy.public')) +
      '</span></h2>' +
      '<p class="settings__hint">' +
        (priv ? t('settings.privacy.hint_private') : t('settings.privacy.hint_public')) +
      '</p>' +
      '<div class="settings-form__actions">' +
        '<button type="button" class="btn btn--' + (priv ? 'ghost' : 'primary') + '" id="privacy-toggle">' +
          icon(priv ? 'globe' : 'lock', { size: 14, className: 'icon--inline' }) +
          (priv ? t('settings.privacy.go_public') : t('settings.privacy.go_private')) +
        '</button>' +
      '</div>' +
      '<p class="settings-status" id="privacy-status"></p>' +
    '</section>' +
    audienceCard()
  );
}

// Edit the per-list audiences used by 「親しい友達」 and 「同じ組織」
// post visibilities. Instagram-style: each list shows the current
// members as removable chips on top, and a search input below that
// queries profiles and lets you add them with one tap.
function audienceCard() {
  const me = currentUser();
  if (!me) return '';
  // Seed the in-memory editor state from the projected user. Done
  // here (not at module load) so a login switch picks up the right
  // lists when the user opens /settings.
  audienceState.closeFriends = Array.isArray(me.closeFriends) ? me.closeFriends.slice() : [];
  audienceState.orgMembers   = Array.isArray(me.orgMembers)   ? me.orgMembers.slice()   : [];
  return (
    '<section class="settings-card">' +
      '<h2>' + t('settings.audience.title') + '</h2>' +
      '<p class="settings__hint">' + t('settings.audience.hint') + '</p>' +
      audienceEditor('closeFriends', t('settings.audience.friends')) +
      audienceEditor('orgMembers',   t('settings.audience.org_members')) +
      '<form class="settings-form" id="org-label-form">' +
        '<label>' + t('settings.audience.org') +
          '<input name="organization" type="text" autocomplete="off" maxlength="80" ' +
            'placeholder="' + attr(t('settings.audience.org_placeholder')) + '" value="' + attr(me.organization || '') + '">' +
        '</label>' +
        '<div class="settings-form__actions">' +
          '<button type="submit" class="btn btn--ghost btn--sm">' + t('settings.audience.save') + '</button>' +
        '</div>' +
        '<p class="settings-status" id="org-label-status"></p>' +
      '</form>' +
    '</section>'
  );
}

// One list-editor block. `kind` keys into audienceState and tags the
// input / chip-row / results-row via data-* attrs so the document-
// level handlers below can find the right list to mutate.
function audienceEditor(kind, label) {
  return (
    '<div class="audience-editor">' +
      '<label class="audience-editor__label">' + attr(label) +
        '<span class="audience-editor__count" data-audience-count="' + kind + '">(' + audienceState[kind].length + ')</span>' +
      '</label>' +
      '<div class="audience-editor__chips" data-audience-chips="' + kind + '">' +
        audienceState[kind].map(h => audienceChip(kind, h)).join('') +
      '</div>' +
      '<div class="audience-editor__search">' +
        '<input type="text" autocomplete="off" spellcheck="false" ' +
          'placeholder="' + attr(t('settings.audience.search_placeholder')) + '" ' +
          'data-audience-search="' + kind + '">' +
        '<div class="audience-editor__results" data-audience-results="' + kind + '" hidden></div>' +
      '</div>' +
      '<p class="settings-status audience-editor__status" data-audience-status="' + kind + '"></p>' +
    '</div>'
  );
}

function audienceChip(kind, handle) {
  const u = getUser(handle) || { handle, name: handle, avatar: (handle[0] || '?').toUpperCase() };
  return (
    '<span class="audience-chip" data-handle="' + attr(handle) + '">' +
      renderAvatar(u, { size: 'sm' }) +
      '<span class="audience-chip__handle">@' + attr(handle) + '</span>' +
      '<button type="button" class="audience-chip__remove" ' +
        'data-audience-remove="' + kind + '" data-handle="' + attr(handle) + '" ' +
        'aria-label="削除">×</button>' +
    '</span>'
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

  // ----- Instagram-style audience editors (close friends + org) -----
  //
  // State lives in `audienceState` (top of file). Every add/remove
  // immediately POSTs the new list via updateProfile so the user
  // doesn't have to remember to hit Save. Search is debounced and
  // hits Supabase via searchProfiles, then renders matches with a
  // + button — already-listed handles render greyed-out.

  function showAudienceStatus(kind, key, cls) {
    const el = document.querySelector('[data-audience-status="' + kind + '"]');
    if (!el) return;
    el.textContent = t(key);
    el.className = 'settings-status audience-editor__status' + (cls ? ' is-' + cls : '');
  }

  async function persistAudience(kind) {
    const me = currentUser();
    if (!me) return;
    showAudienceStatus(kind, 'settings.audience.saving');
    try {
      await updateProfile({ [kind]: audienceState[kind].slice() });
      showAudienceStatus(kind, 'settings.audience.saved', 'ok');
    } catch (ex) {
      showAudienceStatus(kind, 'settings.audience.failed', 'bad');
      console.warn('persistAudience', ex);
    }
  }

  function rerenderChips(kind) {
    const host = document.querySelector('[data-audience-chips="' + kind + '"]');
    const countEl = document.querySelector('[data-audience-count="' + kind + '"]');
    if (host) host.innerHTML = audienceState[kind].map(h => audienceChip(kind, h)).join('');
    if (countEl) countEl.textContent = '(' + audienceState[kind].length + ')';
  }

  function rerenderResults(kind, profiles, query) {
    const host = document.querySelector('[data-audience-results="' + kind + '"]');
    if (!host) return;
    const me = currentUser();
    const filtered = (profiles || []).filter(p =>
      p && p.handle && (!me || p.handle !== me.handle)
    );
    if (!filtered.length) {
      host.hidden = !query;
      if (query) host.innerHTML =
        '<div class="audience-editor__empty">' + t('settings.audience.no_results') + '</div>';
      return;
    }
    host.hidden = false;
    host.innerHTML = filtered.slice(0, 8).map(p => {
      const already = audienceState[kind].includes(p.handle);
      return (
        '<button type="button" class="audience-result' + (already ? ' is-added' : '') +
          '" data-audience-add="' + kind + '" data-handle="' + attr(p.handle) + '"' +
          (already ? ' disabled' : '') + '>' +
          renderAvatar(p, { size: 'sm' }) +
          '<span class="audience-result__text">' +
            '<span class="audience-result__name">' + attr(p.name || p.handle) + '</span>' +
            '<span class="audience-result__handle">@' + attr(p.handle) + '</span>' +
          '</span>' +
          '<span class="audience-result__add">' + (already ? '✓' : '+') + '</span>' +
        '</button>'
      );
    }).join('');
  }

  // Default candidate set: handles the current user already follows.
  // Picking close-friends / org members from "people you follow" is
  // the common case, so we show them without forcing a search query.
  // Missing profile metadata (avatar / name) → use the handle as a
  // best-effort label; fetchProfileByHandle hydrates the cache in
  // the background and a follow-up showSuggestions paints the names.
  function showSuggestions(kind) {
    const taken = new Set(audienceState[kind]);
    const me = currentUser();
    const handles = myFollowingHandles()
      .filter(h => !taken.has(h) && (!me || h !== me.handle));
    const profiles = handles.map(h => getUser(h) || { handle: h, name: h });
    rerenderResults(kind, profiles, profiles.length ? '__suggestions__' : '');
    // Background-fill missing profiles, then re-render once when any
    // arrive. Cheap: each handle gets fetched at most once.
    const missing = profiles.filter(p => !p.avatar && !p.name).map(p => p.handle);
    if (missing.length) {
      Promise.allSettled(missing.map(h => fetchProfileByHandle(h)))
        .then((rs) => { if (rs.some(r => r.status === 'fulfilled' && r.value)) showSuggestions(kind); });
    }
  }

  // Per-kind debounced search so typing fast doesn't fire one
  // round trip per keystroke.
  const debouncedSearch = {
    closeFriends: debounce(async (q) => {
      const profiles = q ? await searchProfiles(q, 10).catch(() => []) : [];
      rerenderResults('closeFriends', profiles, q);
    }, 220),
    orgMembers:   debounce(async (q) => {
      const profiles = q ? await searchProfiles(q, 10).catch(() => []) : [];
      rerenderResults('orgMembers', profiles, q);
    }, 220),
  };

  // Guarded so re-binding (every /settings nav) doesn't stack
  // duplicate listeners on the document.
  if (!bindSettings._audienceWired) {
    bindSettings._audienceWired = true;

  document.addEventListener('input', (e) => {
    const input = e.target;
    if (!(input instanceof HTMLInputElement)) return;
    const kind = input.getAttribute('data-audience-search');
    if (!kind || !debouncedSearch[kind]) return;
    const q = input.value.trim().replace(/^@/, '');
    // Empty query: don't blank the suggestions panel — show the
    // follow-based candidates again. Typing brings up search.
    if (!q) { showSuggestions(kind); return; }
    debouncedSearch[kind](q);
  });
  // Also re-show suggestions when the input gets focus (covers
  // tap-to-open without typing).
  document.addEventListener('focusin', (e) => {
    const input = e.target;
    if (!(input instanceof HTMLInputElement)) return;
    const kind = input.getAttribute('data-audience-search');
    if (!kind) return;
    if (!input.value.trim()) showSuggestions(kind);
  });

  document.addEventListener('click', (e) => {
    // Add a handle to the list.
    const addBtn = e.target.closest('[data-audience-add]');
    if (addBtn) {
      e.preventDefault();
      const kind = addBtn.getAttribute('data-audience-add');
      const handle = addBtn.getAttribute('data-handle');
      if (!kind || !handle || !audienceState[kind]) return;
      if (audienceState[kind].includes(handle)) return;
      audienceState[kind].push(handle);
      rerenderChips(kind);
      // Re-mark the search result row as added.
      addBtn.classList.add('is-added');
      addBtn.disabled = true;
      const plus = addBtn.querySelector('.audience-result__add');
      if (plus) plus.textContent = '✓';
      persistAudience(kind);
      return;
    }
    // Remove a handle from the list.
    const rmBtn = e.target.closest('[data-audience-remove]');
    if (rmBtn) {
      e.preventDefault();
      const kind = rmBtn.getAttribute('data-audience-remove');
      const handle = rmBtn.getAttribute('data-handle');
      if (!kind || !handle || !audienceState[kind]) return;
      const i = audienceState[kind].indexOf(handle);
      if (i < 0) return;
      audienceState[kind].splice(i, 1);
      rerenderChips(kind);
      // If the same handle is in the visible results, un-grey it.
      const results = document.querySelector('[data-audience-results="' + kind + '"]');
      if (results) {
        const stale = results.querySelector('[data-handle="' + handle.replace(/"/g, '\\"') + '"]');
        if (stale) {
          stale.classList.remove('is-added');
          stale.disabled = false;
          const plus = stale.querySelector('.audience-result__add');
          if (plus) plus.textContent = '+';
        }
      }
      persistAudience(kind);
      return;
    }
  });

  } // end _audienceWired guard

  // Paint default candidates on every /settings open. Waits for
  // the follow list to be hydrated so the suggestions aren't empty
  // on a fresh session.
  if (currentUser()) {
    hydrateMyFollows().then(() => {
      showSuggestions('closeFriends');
      showSuggestions('orgMembers');
    });
  }

  // Org label form (free-text "Organization" — profile display only).
  const orgLabelForm = document.getElementById('org-label-form');
  orgLabelForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const me = currentUser();
    if (!me) return;
    const fd = new FormData(orgLabelForm);
    const organization = String(fd.get('organization') || '').trim();
    const status = document.getElementById('org-label-status');
    if (status) status.textContent = t('settings.audience.saving');
    try {
      await updateProfile({ organization });
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
