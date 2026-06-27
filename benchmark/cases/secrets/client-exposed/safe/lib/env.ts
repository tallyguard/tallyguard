// SAFE (precision controls): all legitimately client-side - a Stripe publishable key, a Supabase
// anon key, and a public API URL - plus a real secret kept server-only (no NEXT_PUBLIC_ prefix).
// None of these must flag.
export const stripePublishable = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
export const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
export const apiUrl = process.env.NEXT_PUBLIC_API_URL;
export const serverSecret = process.env.STRIPE_SECRET_KEY;
