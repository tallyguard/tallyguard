import { Resend } from "resend";

// Module-level client singleton, exposed via a getter (a common real-world pattern).
const resend = new Resend(process.env.RESEND_API_KEY);

export function getResend(): Resend {
  return resend;
}
