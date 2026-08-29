import type { FastifyInstance } from "fastify";
import WebSocket from "ws";

import { config } from "../config";
import type { ClientSettings } from "../types";
import { createDeepgramSocket } from "../speech/deepgram";
import { translateText } from "../speech/translator";
import { broadcastToRoom, joinRoom, leaveAllRooms } from "./rooms";
import {
  consumePairingSession,
  createPairingSession,
  removePairingSessionsForSocket,
} from "./pairing";

const DEFAULT_SETTINGS: ClientSettings = {
  sourceLanguage: "en",
  targetLanguage: "uk",
  mode: "normal",
};

const MAX_PRODUCER_SESSION_MS = 10 * 60 * 1000;
const PRODUCER_IDLE_TIMEOUT_MS = 30 * 1000;

function safeSend(socket: WebSocket, payload: unknown) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

export function registerWebSocketRoute(app: FastifyInstance) {
  app.get("/ws", { websocket: true }, (connection) => {
    console.log("Client connected");
  
    let isTrustedProducer = false;
    let settings: ClientSettings = { ...DEFAULT_SETTINGS };
    let dgSocket: WebSocket | null = null;
    let lastFinalTranscript = "";
    let producerStartedAt: number | null = null;
    let maxProducerTimer: NodeJS.Timeout | null = null;
    let idleProducerTimer: NodeJS.Timeout | null = null;
  
    function cleanupProducerTimers() {
      if (maxProducerTimer) {
        clearTimeout(maxProducerTimer);
        maxProducerTimer = null;
      }
  
      if (idleProducerTimer) {
        clearTimeout(idleProducerTimer);
        idleProducerTimer = null;
      }
    }
  
    function closeProducer(reason: string) {
      console.warn("Closing producer websocket:", reason);
  
      safeSend(connection, {
        type: "producer_closed",
        reason,
      });
  
      cleanupProducerTimers();
  
      if (dgSocket) {
        dgSocket.close();
        dgSocket = null;
      }
  
      connection.close();
    }
  
    function startProducerSessionIfNeeded() {
      if (producerStartedAt) {
        return;
      }
  
      producerStartedAt = Date.now();
  
      maxProducerTimer = setTimeout(() => {
        closeProducer("max_session_time_reached");
      }, MAX_PRODUCER_SESSION_MS);
    }
  
    function resetProducerIdleTimer() {
      if (idleProducerTimer) {
        clearTimeout(idleProducerTimer);
      }
  
      idleProducerTimer = setTimeout(() => {
        closeProducer("audio_idle_timeout");
      }, PRODUCER_IDLE_TIMEOUT_MS);
    }
  
    function connectDeepgram() {
      if (dgSocket) {
        dgSocket.close();
        dgSocket = null;
      }
  
      lastFinalTranscript = "";
  
      dgSocket = createDeepgramSocket(settings.sourceLanguage);
  
      dgSocket.on("open", () => {
        console.log("Deepgram connected:", settings);
  
        safeSend(connection, {
          type: "stt_ready",
          sourceLanguage: settings.sourceLanguage,
          targetLanguage: settings.targetLanguage,
        });
      });
  
      dgSocket.on("message", async (raw) => {
  try {
    const data = JSON.parse(raw.toString());

    if (data.type !== "Results") {
      return;
    }

    const transcript = data.channel?.alternatives?.[0]?.transcript?.trim() ?? "";

    console.log("Deepgram result:", {
      transcript,
      isFinal: data.is_final,
      speechFinal: data.speech_final,
      fromFinalize: data.from_finalize,
      duration: data.duration,
      start: data.start,
    });

    if (!transcript) {
      console.log("Deepgram transcript empty, skipping");
      return;
    }

    safeSend(connection, {
      type: "transcript",
      text: transcript,
      isFinal: data.is_final,
    });

    if (!data.is_final) {
      return;
    }

    console.log("Translating final transcript:", transcript);

    const translated = await translateText(
  transcript,
  settings.sourceLanguage,
  settings.targetLanguage,
  settings.mode
);

    console.log("Translation result:", translated);

    safeSend(connection, {
      type: "translation",
      original: transcript,
      translated,
      mode: settings.mode,
    });
  } catch (error) {
    console.error("Failed to handle Deepgram message:", error);
  }
});
  
      dgSocket.on("error", (error) => {
        console.error("Deepgram error:", error);
  
        safeSend(connection, {
          type: "error",
          message: "Deepgram connection error",
        });
      });
  
      dgSocket.on("close", () => {
        console.log("Deepgram disconnected");
      });
    }
  
    connection.on("message", (message, isBinary) => {
      if (isBinary) {
    if (!isTrustedProducer) {
      console.warn("Rejected audio chunk from unauthenticated websocket client");
      connection.close();
      return;
    }
  
    startProducerSessionIfNeeded();
    resetProducerIdleTimer();
  
    if (!dgSocket) {
      connectDeepgram();
    }
  
    if (dgSocket?.readyState === WebSocket.OPEN) {
      dgSocket.send(message);
    }
  
    return;
  }
  
      try {
        const payload = JSON.parse(message.toString());
  
        if (payload.type === "create_pairing") {
    const session = createPairingSession(
  connection,
  config.pairingTtlMs
);
  
    safeSend(connection, {
      type: "pairing_created",
      code: session.code,
      expiresInMs: config.pairingTtlMs,
    });
  
    return;
  }
  
  if (payload.type === "pair_room") {
    if (!config.pocketwaveBotSecret || payload.botSecret !== config.pocketwaveBotSecret) {
      console.warn("Rejected pair_room: invalid bot secret", {
        code: payload.code,
        roomId: payload.roomId,
      });
  
      safeSend(connection, {
        type: "error",
        message: "Invalid bot secret",
      });
  
      return;
    }
  
    const code = String(payload.code ?? "");
    const roomId = String(payload.roomId ?? "");
    const guildName = String(payload.guildName ?? "");
  
    if (!code || !roomId) {
      safeSend(connection, {
        type: "error",
        message: "code and roomId are required",
      });
  
      return;
    }
  
    const session = consumePairingSession(code);
  
    if (!session) {
      safeSend(connection, {
        type: "pairing_failed",
        reason: "invalid_or_expired_code",
      });
  
      return;
    }
  
    leaveAllRooms(session.socket);
  
    joinRoom(roomId, {
      socket: session.socket,
      role: "viewer",
    });
  
    safeSend(session.socket, {
      type: "paired_room",
      roomId,
      guildName,
    });
  
    safeSend(connection, {
      type: "pairing_ok",
      roomId,
      code: code.trim().toUpperCase(),
    });
  
    console.log(`Paired desktop code ${code} with room ${roomId} (${guildName})`);
  
    return;
  }
        if (payload.type === "producer_auth") {
      if (!config.pocketwaveBotSecret || payload.botSecret !== config.pocketwaveBotSecret) {
      console.warn("Rejected producer_auth: invalid bot secret");
      connection.close();
      return;
    }
  
    isTrustedProducer = true;
  
    safeSend(connection, {
      type: "producer_auth_ok",
    });
  
    return;
  }
  
        if (payload.type === "settings") {
          const incomingMode =
      payload.mode === "tactical" ? "tactical" : DEFAULT_SETTINGS.mode;
  
      if (!isTrustedProducer) {
    console.warn("Rejected settings from unauthenticated websocket client");
    connection.close();
    return;
  }
  
    settings = {
      sourceLanguage: payload.sourceLanguage ?? DEFAULT_SETTINGS.sourceLanguage,
      targetLanguage: payload.targetLanguage ?? DEFAULT_SETTINGS.targetLanguage,
      mode: incomingMode,
    };
  
          console.log("Settings updated:", settings);
  
          connectDeepgram();
          startProducerSessionIfNeeded();
  resetProducerIdleTimer();
  
          safeSend(connection, {
            type: "settings_applied",
            sourceLanguage: settings.sourceLanguage,
            targetLanguage: settings.targetLanguage,
            mode: settings.mode,
          });
  
          return;
        }
  
        if (payload.type === "finalize") {
    console.log("Finalize requested");
  
    if (!isTrustedProducer) {
    console.warn("Rejected settings from unauthenticated websocket client");
    connection.close();
    return;
  }
  
    if (dgSocket?.readyState === WebSocket.OPEN) {
      dgSocket.send(
        JSON.stringify({
          type: "Finalize",
        })
      );
    }
  
    return;
  }
        if (payload.type === "join_room") {
    const roomId = String(payload.roomId ?? "");
    const role = payload.role === "producer" ? "producer" : "viewer";
  
    if (!roomId) {
      safeSend(connection, {
        type: "error",
        message: "roomId is required",
      });
      return;
    }
  
    joinRoom(roomId, {
      socket: connection,
      role,
    });
  
    safeSend(connection, {
      type: "room_joined",
      roomId,
      role,
    });
  
    return;
  }

  if (payload.type === "room_speaking") {
  const roomId = String(payload.roomId ?? "");

  if (
    !config.pocketwaveBotSecret ||
    payload.botSecret !== config.pocketwaveBotSecret
  ) {
    console.warn("Rejected room_speaking: invalid bot secret");
    return;
  }

  if (!roomId) {
    return;
  }

  broadcastToRoom(roomId, {
    type: "overlay_speaking",
    roomId,
    userId: payload.userId,
    speakerName: payload.speakerName,
    speaking: Boolean(payload.speaking),
  });

  return;
}
  
if (payload.type === "room_session_state") {
  const roomId = String(payload.roomId ?? "");

  if (
    !config.pocketwaveBotSecret ||
    payload.botSecret !== config.pocketwaveBotSecret
  ) {
    console.warn(
      "Rejected room_session_state: invalid bot secret"
    );
    return;
  }

  if (!roomId) {
    return;
  }

  broadcastToRoom(roomId, {
    type: "overlay_session_state",

    roomId,
    active: Boolean(payload.active),

    sourceLanguage:
      payload.sourceLanguage ?? "en",

    targetLanguage:
      payload.targetLanguage ?? "uk",

    mode:
      payload.mode === "tactical"
        ? "tactical"
        : "normal",

    voiceEnabled:
      Boolean(payload.voiceEnabled),
  });

  return;
}

  if (payload.type === "room_translation") {
    const roomId = String(payload.roomId ?? "");
    if (!config.pocketwaveBotSecret || payload.botSecret !== config.pocketwaveBotSecret) {
      console.warn("Rejected room_translation: invalid bot secret", {
        roomId: payload.roomId,
        userId: payload.userId,
      });
  
      return;
    }
  
    if (!roomId) {
      safeSend(connection, {
        type: "error",
        message: "roomId is required",
      });
      return;
    }
  
    broadcastToRoom(roomId, {
  type: "overlay_translation",

  roomId,
  userId: payload.userId,
  speakerName: payload.speakerName,

  original: payload.original,
  translated: payload.translated,

  sourceLanguage: payload.sourceLanguage,
  targetLanguage: payload.targetLanguage,

  mode: payload.mode ?? "normal",
  voiceEnabled: payload.voiceEnabled ?? false,
});
  
    return;
  }
      } catch {
        console.log("Text message:", message.toString());
      }
    });
  
    connection.on("close", () => {
    console.log("Client disconnected");
  
    cleanupProducerTimers();
    removePairingSessionsForSocket(connection);
    leaveAllRooms(connection);
  
    if (dgSocket) {
      dgSocket.close();
      dgSocket = null;
    }
  });
  });
}

