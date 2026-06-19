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

const ALIAS_DOMAIN = '@spotcode-sns.local';

const ALIASES = {
  // bare identifier → full email Supabase actually stores
  'dev.test.account': 'dev.test.account' + ALIAS_DOMAIN,
};

// Handles that are pre-claimed by the project itself. Used by the
// auth modal to block any signup attempt that would collide with
// the brand / QA accounts (which are signed up once by the admin
// and must never be re-claimed by a random user).
export const RESERVED_HANDLES = new Set([
  'spotcode_official',
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
  const expanded   = resolveLoginEmail(rawEmail).toLowerCase();
  const bareEmail  = rawEmail.toLowerCase();
  const cleanHandle = String(handle || '').trim().toLowerCase();

  if (cleanHandle && RESERVED_HANDLES.has(cleanHandle)) {
    return 'このハンドルは予約されています（@' + cleanHandle + ' は運営専用です）。別のハンドルを選んでください。';
  }
  // Reject the bare alias OR its expanded form OR ANY use of the
  // internal domain — only the ALIASES map machinery is allowed to
  // mint addresses there.
  if (ALIASES[bareEmail]) {
    return 'この識別子は予約されています（' + bareEmail + ' は運営専用）。';
  }
  if (expanded.endsWith(ALIAS_DOMAIN.toLowerCase())) {
    return 'このドメイン (' + ALIAS_DOMAIN + ') は内部予約です。実在するメールアドレスでサインアップしてください。';
  }
  return null;
}
