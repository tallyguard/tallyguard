// VULNERABLE: a paid LLM API called directly from the browser (this file is under public/, served
// verbatim to the client). The Anthropic key must be in the client - exposed to every visitor - and
// there is no server-side rate limit (denial-of-wallet).
async function ask(prompt) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: "claude-3-haiku",
      messages: [{ role: "user", content: prompt }],
    }),
  });
  return res.json();
}
