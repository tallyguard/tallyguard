// SAFE: the client calls its OWN backend, which proxies to the LLM server-side. No AI host appears
// in an HTTP call from the client, so there is no key exposure and the server can rate-limit.
// Precision controls (must NOT flag): a log line and a comment that merely name a provider host.
console.log("chat is powered by api.anthropic.com (server-side)"); // not an HTTP call -> not a leak
async function ask(prompt) {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt }),
  });
  return res.json();
}
