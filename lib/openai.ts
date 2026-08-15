import OpenAI from "openai";

let openaiClient: OpenAI | null = null;

export function getOpenAIClient(): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY || "",
      organization: process.env.OPENAI_ORG_ID || undefined,
    });
  }
  return openaiClient;
}

export function isLiveImageGenerationEnabled(): boolean {
  return process.env.LIVE_IMAGE_GENERATION_ENABLED === "true";
}
