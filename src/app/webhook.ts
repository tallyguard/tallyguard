// SPDX-License-Identifier: Apache-2.0
// GitHub webhook signature verification: HMAC-SHA256 over the raw body, compared in
// constant time (D008 / security best practice). Probot does this internally; this is
// provided for any non-Probot host and is independently tested.

import { createHmac, timingSafeEqual } from "node:crypto";

/** Verify an `X-Hub-Signature-256` header (`sha256=<hex>`) against the raw request body. */
export function verifyWebhookSignature(
  secret: string,
  rawBody: string,
  signatureHeader: string | undefined,
): boolean {
  if (!signatureHeader) return false;
  const expected = "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
