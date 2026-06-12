// Default Supabase project for the spotcode-sns shared deployment.
//
// These credentials are SAFE TO COMMIT because:
//   - SUPA_URL is just the API endpoint, public by design
//   - SUPA_ANON is the "publishable" key — Supabase explicitly markets
//     it as browser-safe; what users can actually do is gated by the
//     Row-Level Security policies in docs/supabase-schema.sql
//
// Never paste a `sb_secret_…` / `service_role` key here. That one is
// admin-level and would let any site visitor delete the entire DB.
//
// Power users who want to point the app at their own Supabase project
// can override these at runtime via /settings (saved in localStorage,
// takes precedence over these defaults).

export const SUPA_URL  = 'https://vkwdthjiyxrhskdlgexq.supabase.co';
export const SUPA_ANON = 'sb_publishable_xdAZG7yOOFKPXmugjhDWdQ_HJ7sGHIq';
