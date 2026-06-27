import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// VULNERABLE: an inline server action (its own "use server" directive) inside a component file
// with NO top-level directive, reaching the LLM sink with no rate limit.
export default function Page() {
  async function generate(formData: FormData) {
    "use server";
    const prompt = String(formData.get("prompt"));
    await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
    });
  }
  return <form action={generate} />;
}
