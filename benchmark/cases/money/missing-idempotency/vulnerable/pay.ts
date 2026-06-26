import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

// VULNERABLE: a payment intent created with no idempotency key (double-charges on retry).
export async function charge(amount: number) {
  return stripe.paymentIntents.create({ amount, currency: "usd" });
}
