import "dotenv/config";
import Fastify from "fastify";
import websocket from "@fastify/websocket";
import WebSocket from "ws";
import OpenAI from "openai";
import crypto from "node:crypto";
import { config } from "./config";
import { ClientSettings, PairingSession, RoomClient, TranslationMode } from "./types";
import { broadcastToRoom, joinRoom, leaveAllRooms } from "./ws/rooms";
import { createPairingSession, consumePairingSession, removePairingSessionsForSocket } from "./ws/pairing";

const POCKETWAVE_BOT_SECRET = config.pocketwaveBotSecret;

if (!POCKETWAVE_BOT_SECRET) {
  console.warn("POCKETWAVE_BOT_SECRET is not configured. Room relay is not protected.");
}

const MAX_PRODUCER_SESSION_MS = Number(
  process.env.MAX_PRODUCER_SESSION_MS ?? 30 * 60 * 1000
);

const PRODUCER_IDLE_TIMEOUT_MS = Number(
  process.env.PRODUCER_IDLE_TIMEOUT_MS ?? 60 * 1000
);

const app = Fastify({
  logger: true,
});

await app.register(websocket);

const openai = new OpenAI({
  apiKey: config.openAiApiKey,
});

const PAIRING_TTL_MS = Number(process.env.PAIRING_TTL_MS ?? 10 * 60 * 1000);

const DEFAULT_SETTINGS: ClientSettings = {
  sourceLanguage: "en",
  targetLanguage: "uk",
  mode: "normal",
};

const targetLanguageNames: Record<string, string> = {
  uk: "Ukrainian",
  en: "English",
  pl: "Polish",
  de: "German",
  es: "Spanish",
  fr: "French",
};

function buildDeepgramUrl(sourceLanguage: string) {
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

async function translateText(
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

function safeSend(socket: WebSocket, payload: unknown) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

app.get("/health", async () => {
  return { status: "ok" };
});

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

    const dgUrl = buildDeepgramUrl(settings.sourceLanguage);

    dgSocket = new WebSocket(dgUrl, {
      headers: {
        Authorization: `Token ${config.deepgramApiKey}`,
      },
    });

    dgSocket.on("open", () => {
      console.log("Deepgram connected:", settings);

      safeSend(connection, {
        type: "stt_ready",
        sourceLanguage: settings.sourceLanguage,
        targetLanguage: settings.targetLanguage,
      });
    });

    dgSocket.on("message", async (data) => {
      try {
        const response = JSON.parse(data.toString());

        console.log("Deepgram raw:", response);

        const transcript =
          response.channel?.alternatives?.[0]?.transcript?.trim();

        if (!transcript) return;

        const isFinal = response.is_final === true;
        const speechFinal = response.speech_final === true;

        safeSend(connection, {
          type: "transcript",
          text: transcript,
          isFinal,
          speechFinal,
        });

        if (!isFinal && !speechFinal) {
          return;
        }

        if (transcript === lastFinalTranscript) {
          return;
        }

        lastFinalTranscript = transcript;

        console.log("Final transcript:", transcript);

        const translated = await translateText(
          transcript,
          settings.targetLanguage,
          settings.mode
        );

        safeSend(connection, {
          type: "translation",
          original: transcript,
          translated,
          sourceLanguage: settings.sourceLanguage,
          targetLanguage: settings.targetLanguage,
          mode: settings.mode,
        });
      } catch (error) {
        console.error("Deepgram message parse error:", error);
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
  const session = createPairingSession(connection, {});

  safeSend(connection, {
    type: "pairing_created",
    code: session.code,
    expiresInMs: PAIRING_TTL_MS,
  });

  return;
}

if (payload.type === "pair_room") {
  if (!POCKETWAVE_BOT_SECRET || payload.botSecret !== POCKETWAVE_BOT_SECRET) {
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
  if (!POCKETWAVE_BOT_SECRET || payload.botSecret !== POCKETWAVE_BOT_SECRET) {
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

if (payload.type === "room_translation") {
  const roomId = String(payload.roomId ?? "");
  if (!POCKETWAVE_BOT_SECRET || payload.botSecret !== POCKETWAVE_BOT_SECRET) {
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
    mode: payload.mode ?? "normal",
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

await app.listen({
  port: Number(process.env.PORT ?? 4000),
  host: "0.0.0.0",
});