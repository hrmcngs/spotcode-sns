import { loadMaps } from '../gmap.js';
import { getConfig, getOverride, setConfig, isConfigured, isUsingOverride, ping, getClient } from '../supa.js';
import { canBeDev, isDevMode, setDevMode, currentRole } from '../dev-mode.js';
import { isPrivacyMode, setPrivacyMode, canUsePrivacyMode, maskHandle, maskName } from '../privacy-mode.js';
import { getLang, setLang, t } from '../i18n.js';
import { currentUser, updateProfile, listSavedAccounts, removeSavedAccount, switchAccount, onAuthChange } from '../auth.js';
import { openAuth } from './auth-modal.js';
import { badgesHidden, setBadgesHidden, tasksHidden, setTasksHidden, hiddenTaskRepos, setTaskRepoVisible } from '../display-prefs.js';
import { cachedTasks } from '../github-tasks.js';
import { isPostingAsOfficial, setPostingAsOfficial } from '../posting-identity.js';
import { icon } from '../icons.js';
import { renderAvatar } from '../avatar.js';
import { getUser } from '../data.js';
import { searchProfiles, fetchProfileByHandle } from '../profiles.js';
import { debounce } from '../drafts.js';
import { hydrateMyFollows, myFollowingHandles } from '../interactions.js';
import { navigate, currentPath, url } from '../router.js';
import { isPushEnabled, setPushEnabled, browserPermissionState, requestBrowserPermission } from '../push-notify.js';

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
    '</section>'
  );
}

// Switch an existing account between 個人 and 組織. Visually surfaces
// the Organization badge on the profile page; doesn't change any RLS
// rule (visibility is still about close_friends / org_members lists).
function accountTypeCard() {
  const me = currentUser();
  if (!me) return '';
  const isOrg = !!me.isOrg;
  return (
    '<section class="settings-card">' +
      '<h2>' + t('settings.kind.title') + ' <span class="settings-tag">' +
        icon(isOrg ? 'building' : 'user', { size: 12, className: 'icon--inline' }) +
        (isOrg ? t('settings.kind.org') : t('settings.kind.user')) +
      '</span></h2>' +
      '<p class="settings__hint">' +
        (isOrg ? t('settings.kind.hint_org') : t('settings.kind.hint_user')) +
      '</p>' +
      '<div class="settings-form__actions">' +
        '<button type="button" class="btn btn--' + (isOrg ? 'ghost' : 'primary') + '" id="kind-toggle">' +
          icon(isOrg ? 'user' : 'building', { size: 14, className: 'icon--inline' }) +
          (isOrg ? t('settings.kind.go_user') : t('settings.kind.go_org')) +
        '</button>' +
      '</div>' +
      '<p class="settings-status" id="kind-status"></p>' +
    '</section>'
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
    '</section>'
  );
}

// Free-text "organization" label, shown on the profile as a plain
// string. Lives in its own card so the Save button isn't visually
// inside the audience-list editor (where it confused users into
// thinking it would save the lists too — the lists auto-save on
// add/remove and have no Save button of their own).
function orgLabelCard() {
  const me = currentUser();
  if (!me) return '';
  return (
    '<section class="settings-card">' +
      '<h2>' + t('settings.org_label.title') + '</h2>' +
      '<p class="settings__hint">' + t('settings.org_label.hint') + '</p>' +
      '<form class="settings-form" id="org-label-form">' +
        '<label>' + t('settings.org_label.label') +
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

// (Removed skillsCard — the whole skill-badges feature was dropped.)

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

// Twitter-style account switcher backed by saved-accounts.js. Each
// row is a saved login on this device; clicking switches the active
// session via refresh_token, and × forgets the entry without
// touching the actual account. "Add another account" sign-outs the
// current session so the auth modal lets you log in fresh.
function accountsCard() {
  const me = currentUser();
  if (!me) return '';
  const saved = listSavedAccounts();
  const rows = saved.map(acc => {
    const active = acc.id === me.id;
    const u = { handle: acc.handle, name: acc.name, avatarImage: acc.avatarUrl,
                avatarShape: acc.avatarShape, avatar: (acc.name[0] || '?').toUpperCase() };
    const displayName   = maskName(acc.handle, acc.name);
    const displayHandle = maskHandle(acc.handle);
    // Emails are the single most identifying field on this card — no
    // placeholder can preserve the visual weight without leaking the
    // real address, so drop the "· email" segment entirely for
    // non-self rows while privacy mode is on. The active row (= self)
    // still shows the address because the operator is looking at
    // their own inbox binding.
    const showEmail = !isPrivacyMode() || active;
    return (
      '<div class="account-row' + (active ? ' is-active' : '') + '" data-account-id="' + attr(acc.id) + '">' +
        renderAvatar(u, { size: 'md' }) +
        '<div class="account-row__id">' +
          '<div class="account-row__name">' + attr(displayName) +
            (active ? ' <span class="account-row__badge">' + t('settings.accounts.current') + '</span>' : '') +
          '</div>' +
          '<div class="account-row__handle">@' + attr(displayHandle) +
            (showEmail && acc.email ? ' · ' + attr(acc.email) : '') +
          '</div>' +
        '</div>' +
        '<div class="account-row__actions">' +
          (active
            ? ''
            : '<button type="button" class="btn btn--ghost btn--sm" data-account-switch="' + attr(acc.id) + '">' +
                t('settings.accounts.switch') +
              '</button>') +
          '<button type="button" class="account-row__forget" data-account-forget="' + attr(acc.id) + '" ' +
            'aria-label="' + attr(t('settings.accounts.forget')) + '" title="' + attr(t('settings.accounts.forget')) + '">×</button>' +
        '</div>' +
      '</div>'
    );
  }).join('');
  return (
    '<section class="settings-card">' +
      '<h2>' + t('settings.accounts.title') + '</h2>' +
      '<p class="settings__hint">' + t('settings.accounts.hint') + '</p>' +
      '<div class="accounts-list">' + rows + '</div>' +
      '<div class="settings-form__actions">' +
        '<button type="button" class="btn btn--ghost" id="account-add">' +
          icon('plus', { size: 14, className: 'icon--inline' }) +
          t('settings.accounts.add') +
        '</button>' +
      '</div>' +
      '<p class="settings-status" id="accounts-status"></p>' +
    '</section>'
  );
}

// Compact "Role" indicator so admins / operators see at a glance
// what powers they have, and regular users have somewhere to land
// when they wonder why a friend can delete posts and they can't.
function roleCard() {
  const me = currentUser();
  if (!me) return '';
  const role = currentRole();
  const label = t('settings.role.' + role);
  const desc  = t('settings.role.' + role + '_desc');
  const ico   = role === 'admin' ? 'spark'
              : role === 'operator' ? 'flag'
              : 'user';
  return (
    '<section class="settings-card">' +
      '<h2>' + t('settings.role.title') +
        ' <span class="settings-tag settings-tag--role-' + role + '">' +
          icon(ico, { size: 12, className: 'icon--inline' }) + label +
        '</span></h2>' +
      '<p class="settings__hint">' + desc + '</p>' +
    '</section>'
  );
}

// Twitter / Instagram-style settings sections. The /settings page
// is now grouped into tabs (account / profile / privacy / display
// / + dev for admins) and only the active tab's cards render at a
// time, so the page stops being one long scroll.
//
// Per-tab card composition lives here. The active tab id comes from
// the URL path (/settings/account, /settings/display, …) so the
// browser back button + bookmarks work the same as any other route.

function accountSection() {
  // orgLabelCard moved in here after the "profile" tab was retired —
  // the free-text affiliation is a small enough card to ride with
  // the account-identity group.
  return accountsCard() + roleCard() + accountTypeCard() + orgLabelCard()
       + pushNotifyCard();
}

// Browser Notifications API opt-in. Two switches in series: the
// `Notification.permission` (OS-level "Allow / Block / Default") and
// our own localStorage flag so the user can pause banners without
// re-granting permission each time.
function pushNotifyCard() {
  const perm = browserPermissionState();
  const enabled = isPushEnabled();
  // Status tag mirrors the gate state: ON if permission granted AND
  // user opted in; otherwise the closest reason. 'unsupported' covers
  // iOS Safari < 16.4 and any context without Notification global.
  let statusKey;
  if (perm === 'unsupported')      statusKey = 'settings.push.unsupported';
  else if (perm === 'denied')      statusKey = 'settings.push.denied';
  else if (perm === 'default')     statusKey = 'settings.push.not_asked';
  else if (!enabled)               statusKey = 'settings.push.paused';
  else                             statusKey = 'settings.push.on';

  const actionLabelKey = (perm === 'granted' && enabled)
    ? 'settings.push.turn_off'
    : 'settings.push.turn_on';

  return (
    '<section class="settings-card">' +
      '<h2>' + t('settings.push.title') +
        ' <span class="settings-tag' + (enabled && perm === 'granted' ? ' is-ok' : '') + '">' +
          t(statusKey) +
        '</span>' +
      '</h2>' +
      '<p class="settings__hint">' + t('settings.push.hint') + '</p>' +
      (perm === 'denied'
        ? '<p class="settings-status is-bad">' + t('settings.push.denied_hint') + '</p>'
        : (perm === 'unsupported'
            ? '<p class="settings-status">' + t('settings.push.unsupported_hint') + '</p>'
            : '<div class="settings-form__actions">' +
                '<button type="button" class="btn btn--' +
                  ((perm === 'granted' && enabled) ? 'ghost' : 'primary') +
                  '" id="push-notify-toggle">' +
                  t(actionLabelKey) +
                '</button>' +
              '</div>'
          )
      ) +
    '</section>'
  );
}
function privacySection() {
  // Privacy-mode card lives under Privacy so the @spotcode_dev QA
  // account sees it without needing the admin-only Developer tab.
  // canUsePrivacyMode() gates rendering so regular users don't see a
  // toggle they can't activate (the helpers themselves self-gate too,
  // so a flipped localStorage flag on a non-allowed account is a
  // no-op).
  const privacyModeCard = canUsePrivacyMode()
    ? '<section class="settings-card">' +
        '<h2>' + t('settings.privacy_mode.title') + ' <span class="settings-tag">' + (isPrivacyMode() ? 'ON' : 'OFF') + '</span></h2>' +
        '<p class="settings__hint">' + t('settings.privacy_mode.hint') + '</p>' +
        '<div class="settings-form__actions">' +
          '<button type="button" class="btn btn--' + (isPrivacyMode() ? 'ghost' : 'primary') + '" id="privacy-mode-toggle">' +
            (isPrivacyMode() ? t('settings.privacy_mode.on') : t('settings.privacy_mode.off')) +
          '</button>' +
        '</div>' +
      '</section>'
    : '';
  return privacyCard() + audienceCard() + privacyModeCard;
}
function displaySection() {
  const lang = getLang();
  const hidden = badgesHidden();
  const tHidden = tasksHidden();
  const me = currentUser();
  const taskItems = cachedTasks(me?.github?.handle)?.items || [];
  const taskRepos = [...new Set(taskItems.map((item) => item.repo).filter(Boolean))].sort();
  const hiddenRepos = new Set(hiddenTaskRepos());
  const repoChoices = taskRepos.length
    ? '<div class="settings-task-repos">' + taskRepos.map((repo) =>
        '<label class="settings-check"><input type="checkbox" data-task-repo="' + attr(repo) + '"' +
          (hiddenRepos.has(repo) ? '' : ' checked') + '> <span>' + attr(repo) + '</span></label>'
      ).join('') + '</div>'
    : '<p class="settings__hint">Issue取得後に、ここで表示するリポジトリを選べます。</p>';
  return (
    '<section class="settings-card">' +
      '<h2>' + t('settings.lang.title') + '</h2>' +
      '<p class="settings__hint">' + t('settings.lang.hint') + '</p>' +
      '<div class="settings-form__actions">' +
        '<button type="button" class="btn btn--' + (lang === 'ja' ? 'primary' : 'ghost') + '" data-lang="ja">' + t('settings.lang.ja') + '</button>' +
        '<button type="button" class="btn btn--' + (lang === 'en' ? 'primary' : 'ghost') + '" data-lang="en">' + t('settings.lang.en') + '</button>' +
      '</div>' +
    '</section>' +
    // Single toggle that hides every decorative badge in the app —
    // the {} Programmer pill, the 「組織」 chip on org profiles,
    // the 「アイデア」 / WIP / status badges on posts, the visibility
    // hint. Implemented via a html[data-hide-badges="1"] attribute
    // + the matching CSS rules at the bottom of style.css.
    '<section class="settings-card">' +
      '<h2>' + t('settings.display.badges.title') +
        ' <span class="settings-tag">' + (hidden ? t('settings.display.badges.off') : t('settings.display.badges.on')) + '</span>' +
      '</h2>' +
      '<p class="settings__hint">' + t('settings.display.badges.hint') + '</p>' +
      '<div class="settings-form__actions">' +
        '<button type="button" class="btn btn--' + (hidden ? 'primary' : 'ghost') + '" id="badges-toggle">' +
          (hidden ? t('settings.display.badges.show') : t('settings.display.badges.hide')) +
        '</button>' +
      '</div>' +
    '</section>' +
    // Profile "Open issues (task)" card visibility. When hidden, the
    // whole card doesn't render AND no GitHub API call is spent on
    // fetching issues.
    '<section class="settings-card">' +
      '<h2>' + t('settings.display.tasks.title') +
        ' <span class="settings-tag">' + (tHidden ? t('settings.display.tasks.off') : t('settings.display.tasks.on')) + '</span>' +
      '</h2>' +
      '<p class="settings__hint">' + t('settings.display.tasks.hint') + '</p>' +
      '<div class="settings-form__actions">' +
        '<button type="button" class="btn btn--' + (tHidden ? 'primary' : 'ghost') + '" id="tasks-toggle">' +
          (tHidden ? t('settings.display.tasks.show') : t('settings.display.tasks.hide')) +
        '</button>' +
      '</div>' +
      '<h3>表示するリポジトリ</h3>' + repoChoices +
    '</section>' +
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
      '<p><a href="privacy.html" target="_blank" rel="noopener">' + t('settings.about.privacy') + '</a></p>' +
    '</section>'
  );
}

// Section catalogue. The dev tab is appended at render time only
// for admins so non-admins don't see a hidden tab they can't enter.
const SETTINGS_SECTIONS = [
  { id: 'account', icon: 'user',   render: accountSection },
  { id: 'privacy', icon: 'lock',   render: privacySection },
  { id: 'display', icon: 'gear',   render: displaySection },
];

function visibleSections() {
  if (!canBeDev()) return SETTINGS_SECTIONS;
  return SETTINGS_SECTIONS.concat({ id: 'dev', icon: 'spark', render: null });
}

// Tab id is the third path segment of /settings/<tab>. Reading from
// the route (not location.hash) is essential so that in HASH_MODE
// builds (Electron / iOS Capacitor) the tab survives the hash-routing
// step — `#account` previously got rewritten to `/account` by the
// router's currentPath(), which then matched the @handle profile
// route and rendered "そのアカウントは存在しません".
export function currentSettingsTab() {
  const m = currentPath().match(/^\/settings\/([a-z]+)$/);
  const id = m ? m[1] : '';
  if (visibleSections().some(s => s.id === id)) return id;
  return 'account';
}

function settingsNav(activeId) {
  return (
    '<nav class="settings-nav" role="tablist">' +
      visibleSections().map(s => (
        '<a class="settings-nav__tab' + (s.id === activeId ? ' is-active' : '') + '" ' +
          'role="tab" aria-selected="' + (s.id === activeId ? 'true' : 'false') + '" ' +
          'href="' + url('/settings/' + s.id) + '" data-settings-tab="' + s.id + '">' +
          icon(s.icon, { size: 14, className: 'icon--inline' }) +
          t('settings.tab.' + s.id) +
        '</a>'
      )).join('') +
    '</nav>'
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

    // @spotcode_dev password card — backed by the ensure_dev_account
    // RPC (Stage 29). Auto-creates the auth.users row if it doesn't
    // exist yet, otherwise rotates the password. Admin/operator only;
    // the function double-checks server-side too.
    '<section class="settings-card">' +
      '<h2>' + t('settings.dev_account.title') + '</h2>' +
      '<p class="settings__hint">' + t('settings.dev_account.hint') + '</p>' +
      '<form class="settings-form" id="dev-account-form">' +
        '<label>' + t('settings.dev_account.password_label') +
          '<input name="newPassword" type="password" minlength="8" ' +
            'autocomplete="new-password" placeholder="' + attr(t('settings.dev_account.password_placeholder')) + '">' +
        '</label>' +
        '<div class="settings-form__actions">' +
          '<button type="submit" class="btn btn--primary btn--sm">' + t('settings.dev_account.save') + '</button>' +
        '</div>' +
        '<p class="settings-status" id="dev-account-status"></p>' +
      '</form>' +
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
  const tab = currentSettingsTab();
  const section = visibleSections().find(s => s.id === tab);
  // 'dev' is the only section without a `render` — its content
  // comes from the existing devCards() so admins keep their
  // Supabase override / dev toggle UI on a dedicated tab.
  const body = (tab === 'dev')
    ? devCards({ cfg, override, usingOverride })
    : (section && section.render ? section.render() : '');
  // When the "posting as official" overlay is on, the staffer is
  // viewing their own settings — but updateProfile() now refuses to
  // save in that mode. Surface a banner so the user knows why their
  // Save buttons return an error, and offer a one-tap revert.
  const overlayBanner = isPostingAsOfficial()
    ? '<section class="settings-overlay-banner">' +
        '<span>' + t('settings.overlay.banner') + '</span>' +
        '<button type="button" class="btn btn--ghost btn--sm" data-settings-overlay-revert>' +
          t('settings.overlay.revert') +
        '</button>' +
      '</section>'
    : '';
  return (
    '<div class="settings" data-active-settings-tab="' + tab + '">' +
      '<h1 class="settings__title">' + t('settings.title') + '</h1>' +
      overlayBanner +
      settingsNav(tab) +
      '<div class="settings__content">' + body + '</div>' +
    '</div>'
  );
}

export function bindSettings() {
  // Revert button on the overlay banner — flips the "posting as
  // official" flag off so the staffer can save their own settings.
  const revertBtn = document.querySelector('[data-settings-overlay-revert]');
  if (revertBtn) {
    revertBtn.addEventListener('click', () => {
      setPostingAsOfficial(false);
    });
  }
  // Tab strip — anchor hrefs are `/settings/<tab>` so the browser's
  // back button works and HASH_MODE builds (Electron / iOS) survive
  // the hash-routing pass without the tab id being mistaken for a
  // bare /<handle> profile route. The main dispatcher re-runs
  // renderSettings + bindSettings on every navigation, so a tab
  // click just needs to push the new route via navigate().
  // Selector scoped to the nav anchors specifically — earlier
  // `[data-settings-tab]` also matched the wrapper <div> (which
  // used the same attribute as an "active tab" marker), so a tab
  // click bubbled into the wrapper's handler and immediately
  // pushed the old tab back into the URL.
  document.querySelectorAll('.settings-nav__tab[data-settings-tab]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      const id = el.getAttribute('data-settings-tab');
      if (currentSettingsTab() === id) return;
      // navigate() pushes the URL and triggers the main dispatcher,
      // which re-runs renderSettings/bindSettings — no explicit
      // rerender call needed (would cause a double render).
      navigate('/settings/' + id);
    });
  });

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

  // @spotcode_dev password — calls the `ensure_dev_account` RPC
  // (Stage 29). The RPC self-gates on is_admin / is_operator, so a
  // non-staff user hitting it directly via PostgREST gets a friendly
  // exception rather than a silent write. The card itself is only
  // rendered inside devCards() (allow-listed accounts), but treat the
  // RPC as the actual gate.
  const devForm   = document.getElementById('dev-account-form');
  const devStatus = document.getElementById('dev-account-status');
  devForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const setStatus = (msg, kind = '') => {
      if (!devStatus) return;
      devStatus.textContent = msg;
      devStatus.className = 'settings-status' + (kind ? ' is-' + kind : '');
    };
    const input = devForm.querySelector('input[name="newPassword"]');
    const next = String(input?.value || '');
    if (next.length < 8) { setStatus(t('settings.dev_account.too_short'), 'bad'); return; }
    const submitBtn = devForm.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;
    setStatus(t('settings.dev_account.saving'));
    try {
      const supa = await getClient();
      const { error } = await supa.rpc('ensure_dev_account', { new_pass: next });
      if (error) throw new Error(error.message || String(error));
      if (input) input.value = '';
      setStatus(t('settings.dev_account.saved'), 'ok');
    } catch (ex) {
      setStatus((ex && ex.message) ? ex.message : String(ex), 'bad');
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });

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

  // Badges-visibility toggle — flips the html[data-hide-badges]
  // attribute via display-prefs, then re-renders this card so the
  // button label + state tag update without a full reload.
  document.getElementById('badges-toggle')?.addEventListener('click', () => {
    setBadgesHidden(!badgesHidden());
    // Re-render the Display tab in place so the new state is reflected.
    const app = document.getElementById('app');
    if (app) { app.innerHTML = renderSettings(); bindSettings(); }
  });

  // Tasks-visibility toggle — mirrors the badges toggle above, but
  // targets the profile "Open issues (task)" card. Off state also
  // suppresses the GitHub Search API call in hydrateProfileTasks.
  document.getElementById('tasks-toggle')?.addEventListener('click', () => {
    setTasksHidden(!tasksHidden());
    const app = document.getElementById('app');
    if (app) { app.innerHTML = renderSettings(); bindSettings(); }
  });
  document.querySelectorAll('[data-task-repo]').forEach((input) => {
    input.addEventListener('change', () => {
      setTaskRepoVisible(input.getAttribute('data-task-repo') || '', input.checked);
    });
  });

  // Push-notify toggle — chains the browser permission ask onto the
  // localStorage opt-in so the user gets the OS dialog at the moment
  // they explicitly opt in (not at boot). Asking later is a Chrome
  // best-practice — auto-prompting on page load is now blocked in
  // some browsers, so this is also the only path that works.
  document.getElementById('push-notify-toggle')?.addEventListener('click', async () => {
    const wantOn = !(isPushEnabled() && browserPermissionState() === 'granted');
    if (wantOn) {
      const perm = await requestBrowserPermission();
      if (perm !== 'granted') {
        // Re-render so the status tag flips to denied / unsupported.
        const app = document.getElementById('app');
        if (app) { app.innerHTML = renderSettings(); bindSettings(); }
        return;
      }
      setPushEnabled(true);
    } else {
      setPushEnabled(false);
    }
    const app = document.getElementById('app');
    if (app) { app.innerHTML = renderSettings(); bindSettings(); }
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

  // Account switcher: per-row "Switch" + × handlers, plus the
  // "Add another account" button that sign-outs the current session
  // and pops the auth modal so the user can log into a different one.
  const accountsStatus = document.getElementById('accounts-status');
  function setAccountStatus(msg, cls) {
    if (!accountsStatus) return;
    accountsStatus.textContent = msg || '';
    accountsStatus.className = 'settings-status' + (cls ? ' is-' + cls : '');
  }
  // The click handler is intentionally short — switchAccount() itself
  // stages a localStorage flag and triggers a page reload. The new
  // session is minted in initAuth() on the reloaded runtime, where
  // supabase-js's auto-refresh timer hasn't started yet so it can't
  // race with our refreshSession call. switchAccount() returns a
  // never-resolving Promise to keep the UI disabled until the reload
  // takes over.
  function setAccountButtonsDisabled(disabled) {
    document.querySelectorAll(
      '[data-account-switch], [data-account-forget], #account-add'
    ).forEach(b => { b.disabled = disabled; });
  }
  document.querySelectorAll('[data-account-switch]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-account-switch');
      setAccountButtonsDisabled(true);
      setAccountStatus(t('settings.accounts.switching'));
      // No await — switchAccount synchronously schedules the reload.
      // The only way it rejects is the guard-case "saved entry gone";
      // surface that and re-enable buttons.
      switchAccount(id).catch((ex) => {
        setAccountStatus((ex.message || String(ex)), 'bad');
        setAccountButtonsDisabled(false);
      });
    });
  });
  document.querySelectorAll('[data-account-forget]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-account-forget');
      if (!confirm(t('settings.accounts.confirm_forget'))) return;
      removeSavedAccount(id);
      // Reload so the card re-renders cleanly. The active Supabase
      // session is untouched — "Remove from list" only affects the
      // switcher list, it doesn't log the user out.
      location.reload();
    });
  });
  document.getElementById('account-add')?.addEventListener('click', () => {
    // Just open the auth modal — signInWithPassword / signUp on the
    // form will replace the active session, and the previous account
    // stays in the saved list because we never call forgetAccount.
    // We don't pre-signOut: that fires onAuthStateChange with
    // session=null mid-flight, which makes the topbar / page flip
    // to a "logged out" state for a beat before the modal opens.
    const meBefore = currentUser();
    const off = onAuthChange((u) => {
      // Reload only on transition to a DIFFERENT user — closing the
      // modal without logging in fires no auth change, so this
      // subscription stays dormant until the user actually switches.
      if (u && (!meBefore || u.id !== meBefore.id)) {
        off();
        location.reload();
      }
    });
    openAuth('login');
  });

  // (Removed skill-badge rank picker handler.)

  // Account-type toggle (個人 / 組織). Same pattern as the privacy
  // toggle — flip is_org and reload so every cached view picks up
  // the new badge state.
  const kindBtn    = document.getElementById('kind-toggle');
  const kindStatus = document.getElementById('kind-status');
  kindBtn?.addEventListener('click', async () => {
    const me = currentUser();
    if (!me) return;
    kindBtn.disabled = true;
    if (kindStatus) kindStatus.textContent = t('settings.kind.updating');
    try {
      await updateProfile({ isOrg: !me.isOrg });
      if (kindStatus) {
        kindStatus.textContent = t('settings.kind.updated');
        kindStatus.className = 'settings-status is-ok';
      }
      setTimeout(() => location.reload(), 400);
    } catch (ex) {
      if (kindStatus) {
        kindStatus.textContent = t('settings.kind.failed') + ': ' + (ex.message || ex);
        kindStatus.className = 'settings-status is-bad';
      }
      kindBtn.disabled = false;
    }
  });

  // ----- Instagram-style audience editors (close friends + org) -----
  //
  // State lives in `audienceState` (top of file). Every add/remove
  // immediately POSTs the new list via updateProfile so the user
  // doesn't have to remember to hit Save. Search is debounced and
  // hits Supabase via searchProfiles, then renders matches with a
  // + button — already-listed handles render greyed-out.

  // Two flavours of status: known i18n key (showAudienceStatus) and
  // raw text (showAudienceStatusText) so persistAudience can surface
  // the actual server error — including "DB column missing, run
  // Stage X SQL" — instead of a generic localised "failed".
  function showAudienceStatus(kind, key, cls) {
    showAudienceStatusText(kind, t(key), cls);
  }
  function showAudienceStatusText(kind, text, cls) {
    const el = document.querySelector('[data-audience-status="' + kind + '"]');
    if (!el) return;
    el.textContent = text;
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
      // Roll the in-memory state back to the DB truth so the chip
      // that the user just added doesn't keep "ghost-rendering" while
      // the persisted list is actually empty. The next render will
      // pick up the unchanged cachedUser.
      const fresh = currentUser();
      audienceState[kind] = Array.isArray(fresh?.[kind]) ? fresh[kind].slice() : [];
      rerenderChips(kind);
      showAudienceStatusText(kind, t('settings.audience.failed') + ': ' + (ex.message || String(ex)), 'bad');
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

  // Enter on the search input adds the typed handle directly to the
  // list — saves the user from having to click the "+" on a candidate
  // row. If the typed text doesn't match the handle format, fall
  // through so the user gets the search-results panel instead.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const input = e.target;
    if (!(input instanceof HTMLInputElement)) return;
    const kind = input.getAttribute('data-audience-search');
    if (!kind || !audienceState[kind]) return;
    e.preventDefault();
    const handle = input.value.trim().replace(/^@/, '');
    // Same validation as auth.js — handle must look like a handle.
    if (!/^[A-Za-z0-9_][A-Za-z0-9_-]{1,19}$/.test(handle)) {
      showAudienceStatus(kind, 'settings.audience.invalid_handle', 'bad');
      return;
    }
    if (audienceState[kind].includes(handle)) {
      input.value = '';
      showSuggestions(kind);
      return;
    }
    audienceState[kind].push(handle);
    input.value = '';
    rerenderChips(kind);
    showSuggestions(kind);
    persistAudience(kind);
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

  // Warm the follow list in the background so the suggestion panel
  // has data the moment the user focuses the search input. We do
  // NOT paint suggestions here — they only appear once the input
  // gets focus, so the editor is quiet by default.
  if (currentUser()) hydrateMyFollows();

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

  // Privacy-mode toggle. setPrivacyMode fires onPrivacyModeChange
  // listeners — main.js wires that to refresh() so every visible
  // surface re-renders with the (un)masked identities. We still need
  // to repaint /settings itself so the tag + button label flip
  // immediately; the cheap path is to navigate to the same URL.
  document.getElementById('privacy-mode-toggle')?.addEventListener('click', () => {
    setPrivacyMode(!isPrivacyMode());
    navigate(currentPath(), true);
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
