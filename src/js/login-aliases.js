// Auth identifier aliasing.
//
// Supabase Auth requires `local@domain.tld` format on every signup
// and login request. For internal / shared accounts where we want
// staff to type a short identifier (no @, no domain — "what would
// you call the account out loud"), we keep the stored email as a
// fake-domain string and expand it client-side before each call.
//
// The fake domain `@spotcode-sns.local` is a reserved-ish local TLD
// — no email actually goes there, which is fine because these
// accounts don't receive mail (passwords are managed by hand and
// reset via the Supabase Dashboard).
//
// Current aliases:
//   `dev.test.account`  → `dev.test.account@spotcode-sns.local`  (QA login)
//   `official.account`  → `official.account@spotcode-sns.local`  (brand)
// Add more here as the need arises.

const ALIAS_DOMAIN = '@spotcode-sns.local';

const ALIASES = {
  // bare identifier → full email Supabase actually stores
  'dev.test.account': 'dev.test.account' + ALIAS_DOMAIN,
  'official.account': 'official.account' + ALIAS_DOMAIN,
};

// Two-tier reservation:
//   • RESERVED_AFTER_SIGNUP — names that have already been provisioned
//     by the admin at least once. Random visitors hitting the signup
//     form must be blocked here, otherwise they could re-claim the
//     identifier if the row is ever deleted.
//   • Anything NOT in these sets (including a brand-new alias like
//     `official.account` before the admin has signed it up) stays
//     open so the first signup can go through. Once provisioned,
//     move the handle / bare-alias into RESERVED_AFTER_SIGNUP.
//
// Supabase's `unique(email)` on auth.users and `unique(handle)` on
// profiles already prevent literal duplicates. These sets are the
// extra "this name belongs to the project, not to you" check that
// gives the user a friendlier error than a raw Supabase rejection.
const RESERVED_BARE_LOGINS = new Set([
  'dev.test.account',
]);
export const RESERVED_HANDLES = new Set([
  'spotcode_dev',
]);

// Public so callers (auth modal) can reject any signup attempting
// to use the internal-only fake domain. Real users sign up with a
// real email; only the ALIASES map is allowed to produce a
// `@spotcode-sns.local` address.
export const INTERNAL_DOMAIN = ALIAS_DOMAIN;

// Expand a bare identifier to its stored email. Real emails (with @)
// pass through unchanged. Lowercased + trimmed so casing / stray
// spaces don't bypass the map.
export function resolveLoginEmail(input) {
  const v = String(input || '').trim();
  if (!v) return v;
  if (v.indexOf('@') >= 0) return v;          // already a full email
  const key = v.toLowerCase();
  if (ALIASES[key]) return ALIASES[key];
  return v;                                    // unknown bare id — let Supabase reject
}

// Whether the given identifier matches an aliased bare login —
// helpful for the auth modal to know it shouldn't enforce strict
// `type="email"` validation on bare inputs.
export function isAliasedLogin(input) {
  const v = String(input || '').trim().toLowerCase();
  return !!ALIASES[v];
}

// Accept a login-field value if it either contains `@` (we let
// Supabase enforce the full email format from there) or is a known
// bare alias. Used by the auth modal to reject typos like `foo`
// before they reach Supabase, so the user sees a clear "use a real
// email or the dev alias" error instead of a generic auth failure.
export function isAcceptableLoginEmail(input) {
  const v = String(input || '').trim();
  if (!v) return false;
  if (v.indexOf('@') >= 0) return true;
  return !!ALIASES[v.toLowerCase()];
}

// Signup-side gate: reject any attempt to claim one of the
// pre-reserved identifiers / handles / the internal domain. The
// brand + QA accounts are seeded once by the admin (see README
// setup) and must not be re-claimable by a random visitor —
// otherwise `@spotcode_dev` or `dev.test.account@spotcode-sns.local`
// could end up belonging to someone we don't control.
//
// Returns `null` on OK, or a short Japanese error string explaining
// why the signup is blocked.
export function reservedSignupReason({ email, handle } = {}) {
  const rawEmail   = String(email  || '').trim();
  const bareEmail  = rawEmail.toLowerCase();
  const cleanHandle = String(handle || '').trim().toLowerCase();

  if (cleanHandle && RESERVED_HANDLES.has(cleanHandle)) {
    return 'このハンドルは予約されています（@' + cleanHandle + ' は運営専用です）。別のハンドルを選んでください。';
  }
  if (RESERVED_BARE_LOGINS.has(bareEmail)) {
    return 'この識別子は予約されています（' + bareEmail + ' は運営専用）。';
  }
  // (No blanket `@spotcode-sns.local` reservation — the alias
  //  machinery has to be able to mint addresses there for first-
  //  time signup of a new bare alias. Supabase's unique(email)
  //  prevents literal duplicates of an already-existing one.)
  return null;
}
