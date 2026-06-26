// A helper that does NOT rate-limit (it only logs). Must not count as a guard.
export function logRequest(ip: string): void {
  console.log("request from", ip);
}
