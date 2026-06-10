// ariesModAPI/endpoints/ai.ts
// Endpoints pour Hakyu AI (POST /ai/chat, GET /ai/history)

import { httpPost, httpGet } from "../client/http";
import type { AiChatResponse, AiHistoryResponse } from "../types";

export async function sendAiMessage(message: string): Promise<AiChatResponse | null> {
  const res = await httpPost<AiChatResponse>("ai/chat", { message });
  if (res.status === 200 && res.data) return res.data;
  return null;
}

export async function fetchAiHistory(options: {
  limit?: number;
  before?: number;
} = {}): Promise<AiHistoryResponse | null> {
  const res = await httpGet<AiHistoryResponse>("ai/history", {
    limit: options.limit,
    before: options.before,
  });
  if (res.status === 200 && res.data) return res.data;
  return null;
}
