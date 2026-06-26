import { stripe } from "../../../lib/stripe";
import { prisma } from "../../../lib/db";

// VULNERABLE: checkout session created with no idempotency key. The stripe instance is
// imported from a local wrapper (project-level detection). The prisma.create below is NOT a
// Stripe resource and must not be flagged.
export async function POST(req: Request) {
  const { priceId, userId } = await req.json();
  await prisma.order.create({ data: { userId, priceId } });
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: "https://example.com/ok",
    cancel_url: "https://example.com/no",
  });
  return Response.json({ url: session.url });
}
