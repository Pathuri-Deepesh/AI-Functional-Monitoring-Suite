/**
 * Slugify an API-key user-entered name into a valid `{{var}}` identifier.
 * MUST stay in lock-step with `slugifyKeyName` in backend/src/extraction.ts.
 *
 *   "Stripe Test"        → "stripe_test"
 *   "Stripe Test (live)" → "stripe_test_live"
 *   "2024_key"           → "_2024_key"
 *   "  -- "              → "key"
 */
export function slugifyKeyName(name: string): string {
  let s = (name ?? "").toLowerCase();
  s = s.replace(/[^a-z0-9_]+/g, "_");
  s = s.replace(/_+/g, "_");
  s = s.replace(/^_+|_+$/g, "");
  if (!s) return "key";
  if (/^[0-9]/.test(s)) s = "_" + s;
  return s;
}
