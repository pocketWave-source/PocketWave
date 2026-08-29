import type { Readable } from "node:stream";
import type WebSocket from "ws";

export type TranslationMode = "normal" | "tactical";

export type TranscriberSettings = {
  sourceLanguage: string;
  targetLanguage: string;
  mode: TranslationMode;
  voiceEnabled: boolean;
};

export type ActiveTranscriber = {
  stop: () => void;
  settings: TranscriberSettings;
  startedAt: number;
};

export const activeGuildTranscribers =
  new Map<string, ActiveTranscriber>();
  
export const activeApiSockets =
  new Map<string, Set<WebSocket>>();

export const activeSubscriptions =
  new Map<string, Set<Readable>>();

export const activeSpeakerStreams =
  new Set<string>();

export const lastTranslationByGuild =
  new Map<string, string>();

export const lastDiscordMessageAtByUser =
  new Map<string, number>();

export const DISCORD_MESSAGE_COOLDOWN_MS = 2000;