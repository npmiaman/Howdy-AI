import { ChatGoogleGenerativeAI } from "@langchain/google-genai";

let chatClient: ChatGoogleGenerativeAI | null = null;

export function getChatModel(): ChatGoogleGenerativeAI {
  if (chatClient) return chatClient;
  if (!process.env.GOOGLE_API_KEY) {
    throw new Error(
      "GOOGLE_API_KEY is not set. Add it to .env.local before running the agent.",
    );
  }
  const thinkingLevel = process.env.GEMINI_THINKING_LEVEL as
    | "LOW"
    | "MEDIUM"
    | "HIGH"
    | undefined;
  chatClient = new ChatGoogleGenerativeAI({
    model: process.env.GEMINI_CHAT_MODEL ?? "gemini-flash-latest",
    temperature: 0.2,
    apiKey: process.env.GOOGLE_API_KEY,
    // LangChain's default is 6 retries with exponential backoff — minutes of
    // silent waiting on a 503/429, far past Vercel's 60s limit. Fail fast so
    // the caller's error path (ops alert, claim release) actually runs.
    maxRetries: Number(process.env.GEMINI_MAX_RETRIES ?? 1),
    ...(thinkingLevel ? { thinkingConfig: { thinkingLevel } } : {}),
  });
  return chatClient;
}

const EMBED_MODEL = process.env.GEMINI_EMBED_MODEL ?? "gemini-embedding-001";
const EMBED_DIMS = 768;

class GeminiEmbedder {
  async embedQuery(text: string): Promise<number[]> {
    const [vec] = await this.embedDocuments([text]);
    return vec;
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    if (!process.env.GOOGLE_API_KEY) {
      throw new Error(
        "GOOGLE_API_KEY is not set. Add it to .env.local before running the agent.",
      );
    }
    const out: number[][] = [];
    // The REST API has an embedContents (batch) endpoint, but per-call is fine for our roster size
    // and gives clearer errors during dev.
    for (const text of texts) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:embedContent?key=${process.env.GOOGLE_API_KEY}`;
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: `models/${EMBED_MODEL}`,
          content: { parts: [{ text }] },
          outputDimensionality: EMBED_DIMS,
        }),
      });
      if (!resp.ok) {
        const errorBody = await resp.text();
        throw new Error(
          `Gemini embed failed: ${resp.status} ${resp.statusText} — ${errorBody}`,
        );
      }
      const data = (await resp.json()) as {
        embedding?: { values: number[] };
      };
      if (!data.embedding?.values) {
        throw new Error(`Gemini embed returned no values: ${JSON.stringify(data)}`);
      }
      out.push(data.embedding.values);
    }
    return out;
  }
}

let embedClient: GeminiEmbedder | null = null;

export function getEmbeddingModel(): GeminiEmbedder {
  if (embedClient) return embedClient;
  embedClient = new GeminiEmbedder();
  return embedClient;
}
