// CLEAN: a non-sensitive GET with no catalogued sink. Must NOT be flagged, even
// though it has no rate limiter. Guards against over-flagging every route.
export async function GET() {
  return Response.json({ status: "ok" });
}
