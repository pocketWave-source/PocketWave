import type WebSocket from "ws";

export type TranslationMode = "normal" | "tactical";

export type ClientSettings = {
  sourceLanguage: string;
  targetLanguage: string;
  mode: TranslationMode;
};

export type RoomClient = {
  socket: WebSocket;
  role: "viewer" | "producer";
};

export type PairingSession = {
  code: string;
  socket: WebSocket;
  expiresAt: number;
  timer: NodeJS.Timeout;
};