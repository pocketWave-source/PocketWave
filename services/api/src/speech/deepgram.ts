import WebSocket from "ws";
import { config } from "../config";

export function buildDeepgramUrl(sourceLanguage: string) {
  const url = new URL("wss://api.deepgram.com/v1/listen");

  url.searchParams.set("model", "nova-2");
  url.searchParams.set("language", sourceLanguage);
  url.searchParams.set("smart_format", "true");
  url.searchParams.set("interim_results", "true");
  url.searchParams.set("endpointing", "300");

  url.searchParams.set("encoding", "linear16");
  url.searchParams.set("sample_rate", "16000");
  url.searchParams.set("channels", "1");

  return url.toString();
}

export function createDeepgramSocket(sourceLanguage: string) {
  const dgUrl = buildDeepgramUrl(sourceLanguage);

  console.log("Deepgram connect params:", {
  language: settings.sourceLanguage,
  encoding: "linear16",
  sampleRate: 16000,
  channels: 1,
});

  return new WebSocket(dgUrl, {
    headers: {
      Authorization: `Token ${config.deepgramApiKey}`,
    },
  });
}