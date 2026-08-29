import OpenAI from "openai";
import { config } from "../config";
import type { ClientSettings } from "../types";

const openai = new OpenAI({
  apiKey: config.openaiApiKey,
});

const LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  uk: "Ukrainian",
  pl: "Polish",
  ru: "Russian",
  de: "German",
  fr: "French",
  es: "Spanish",
};

export async function translateText(
  text: string,
  sourceLanguageCode: string,
  targetLanguageCode: string,
  mode: ClientSettings["mode"]
) {
  const sourceLanguage =
    LANGUAGE_NAMES[sourceLanguageCode] ?? sourceLanguageCode;

  const targetLanguage =
    LANGUAGE_NAMES[targetLanguageCode] ?? targetLanguageCode;

  const systemPrompt =
    mode === "tactical"
      ? [
          "You are PocketWave, a real-time voice translator for gamers.",
          `Translate from ${sourceLanguage} to ${targetLanguage}.`,
          `Your output language MUST be ${targetLanguage}.`,
          "Output ONLY the translated tactical callout.",
          "Do not explain.",
          "Do not answer the message.",
          "Do not keep the source language unless it is a game/map term.",
          "Keep it short: 2–8 words when possible.",
        ].join("\n")
      : [
          "You are PocketWave, a real-time voice translator.",
          `Translate from ${sourceLanguage} to ${targetLanguage}.`,
          `Your output language MUST be ${targetLanguage}.`,
          "Output ONLY the translation.",
          "Do not explain.",
          "Do not answer the message.",
          "Do not keep the source language unless it is a name, nickname, or game term.",
        ].join("\n");

  const response = await openai.responses.create({
    model: "gpt-4.1-mini",
    input: [
      {
        role: "system",
        content: systemPrompt,
      },
      {
        role: "user",
        content: text,
      },
    ],
  });

  return response.output_text.trim();
}