// VULNERABLE: a real secret marked NEXT_PUBLIC_, so Next.js inlines it into the client bundle and
// it ships to every visitor's browser.
export const stripeSecret = process.env.NEXT_PUBLIC_STRIPE_SECRET_KEY;
