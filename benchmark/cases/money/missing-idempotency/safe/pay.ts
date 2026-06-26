import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

// SAFE: an idempotency key is passed in the RequestOptions (second) argument.
export async function charge(amount: number, requestId: string) {
  return stripe.paymentIntents.create({ amount, currency: "usd" }, { idempotencyKey: requestId });
}
