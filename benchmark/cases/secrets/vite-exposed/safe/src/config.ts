// Safe: only legitimately-public values carry the VITE_ prefix (a Stripe publishable key and a
// public API base URL), and the real secret is read server-side (no VITE_ prefix, so Vite never
// inlines it into the client bundle). None of these must flag - the precision controls.
export const stripePublishableKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;
export const apiBaseUrl = import.meta.env.VITE_API_BASE_URL;
export const serverStripeSecret = process.env.STRIPE_SECRET_KEY;
