import { stripe } from "../../../lib/stripe";
import { prisma } from "../../../lib/db";

// SAFE: idempotency key passed; the prisma.create is not a Stripe resource.
export async function POST(req: Request) {
  const { priceId, userId, requestId } = await req.json();
  await prisma.order.create({ data: { userId, priceId } });
  const session = await stripe.checkout.sessions.create(
    {
      mode: "payment",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: "https://example.com/ok",
      cancel_url: "https://example.com/no",
    },
    { idempotencyKey: requestId },
  );
  return Response.json({ url: session.url });
}
