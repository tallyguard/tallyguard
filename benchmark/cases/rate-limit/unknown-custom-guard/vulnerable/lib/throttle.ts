// A hand-rolled wrapper the guard catalogue does not recognize as a rate limiter.
export function withThrottle<T extends (...args: unknown[]) => unknown>(handler: T): T {
  return handler;
}
