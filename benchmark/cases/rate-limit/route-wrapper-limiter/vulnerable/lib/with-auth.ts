// A HOF that only authenticates; it does NOT rate-limit.
export function withAuth(handler: (req: Request) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    if (!req.headers.get("authorization")) return new Response("Unauthorized", { status: 401 });
    return handler(req);
  };
}
