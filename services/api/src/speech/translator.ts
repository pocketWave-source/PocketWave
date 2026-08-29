import OpenAI from "openai";
import type { TranslationMode } from "../types";
import { config } from "../config";

const openai = new OpenAI({
  apiKey: config.openAiApiKey,
});

const targetLanguageNames: Record<string, string> = {
  uk: "Ukrainian",
  en: "English",
  pl: "Polish",
  de: "German",
  es: "Spanish",
  fr: "French",
};

export async function translateText(
  text: string,
  targetLanguage: string,
  mode: TranslationMode
) {
  const targetName = targetLanguageNames[targetLanguage] ?? "Ukrainian";

  const normalInstructions = `
Translate gaming voice chat into natural ${targetName}.

Rules:
- Return only the translation.
- Keep it short and readable for subtitles.
- Preserve gaming meaning, not word-for-word translation.
- Keep known gaming terms natural: rush, rotate, heal, push, site, mid, B, A, flank.
- Do not add explanations.
`.trim();

  const tacticalInstructions = `
Convert gaming voice chat into a short tactical callout in ${targetName}.

Rules:
- Return only the tactical callout.
- Maximum 1 short line.
- Prefer 2-6 words when possible.
- Keep urgent gameplay meaning.
- Remove filler words.
- Use short gamer-style phrases.
- Preserve important map/game terms like A, B, mid, short, long, flank, ship, left, right.
- Do not explain.
- Do not add extra context.

Examples:
"They are coming from the left side of our ship" -> "Ворог зліва. Біля корабля."
"Rush B fast, one is low" -> "Швидко B. Один low."
"I need healing behind the wall" -> "Потрібен heal за стіною."
`.trim();

  const response = await openai.responses.create({
    model: "gpt-4.1-mini",
    instructions: mode === "tactical" ? tacticalInstructions : normalInstructions,
    input: text,
  });

  return response.output_text;
}