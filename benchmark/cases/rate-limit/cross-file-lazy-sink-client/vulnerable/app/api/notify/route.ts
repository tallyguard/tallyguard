import { getResend } from "../../../lib/email";

// VULNERABLE: the sink client is built lazily in a helper and used here via a local variable
// (getResend() returns the module-level `new Resend()`), then client.emails.send() is called on
// the result. No rate limit. Requires recognizing a helper that RETURNS a sink client.
export async function POST(req: Request) {
  const { email } = await req.json();
  const client = getResend();
  await client.emails.send({
    from: "noreply@example.com",
    to: String(email),
    subject: "Hello",
    html: "<p>hi</p>",
  });
  return Response.json({ ok: true });
}
