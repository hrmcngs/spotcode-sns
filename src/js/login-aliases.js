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
// Current alias: `dev.test.account` → `dev.test.account@spotcode-sns.local`
// (the in-house QA login). Add more here as the need arises.
//
// The brand `@spotcode_official` account is NOT in this map — it's
// created directly via the Stage 25 SQL bootstrap as a "virtual"
// auth.users row that nobody logs into. No sign-up alias needed.

const ALIAS_DOMAIN = '@spotcode-sns.local';

const ALIASES = {
  // bare identifier → full email Supabase actually stores
  'dev.test.account': 'dev.test.account' + ALIAS_DOMAIN,
};

// Names that the project owns at the bare-alias layer — typing
// just `dev.test.account` and expecting the `@spotcode-sns.local`
// expansion is reserved. The handle layer relies on Supabase's
// own `unique(handle)` constraint on `profiles` to prevent
// duplicate claims after the first signup, so it doesn't need a
// client-side reservation set (and a client-side one would
// chicken-and-egg the very-first signup of `@spotcode_dev` and
// `@spotcode_official`).
const RESERVED_BARE_LOGINS = new Set([
  'dev.test.account',
]);
export const RESERVED_HANDLES = new Set();

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
