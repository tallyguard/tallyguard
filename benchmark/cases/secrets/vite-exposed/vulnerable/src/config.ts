// A Vite app: every VITE_-prefixed env var is inlined into the client bundle at build time, so
// this secret ships to every visitor's browser. -> FLAG
export const stripeSecretKey = import.meta.env.VITE_STRIPE_SECRET_KEY;
