import type { Readable } from "node:stream";

export type ActiveTranscriber = {
  stop: () => void;
};

export const activeGuildTranscribers = new Map<string, ActiveTranscriber>();

export const activeSubscriptions = new Map<string, Set<Readable>>();

export const activeSpeakerStreams = new Set<string>();

export const lastTranslationByGuild = new Map<string, string>();

export const lastDiscordMessageAtByUser = new Map<string, number>();

export const DISCORD_MESSAGE_COOLDOWN_MS = 2000;