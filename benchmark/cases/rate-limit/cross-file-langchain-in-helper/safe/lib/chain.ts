import { ChatOpenAI } from "@langchain/openai";

// The LLM cost is here: constructing and invoking a LangChain chat model.
export async function summarize(text: string): Promise<string> {
  const model = new ChatOpenAI({ temperature: 0 });
  const res = await model.invoke(text);
  return String(res.content);
}
