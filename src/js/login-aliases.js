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
