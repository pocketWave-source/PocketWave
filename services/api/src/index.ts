import "dotenv/config";
import Fastify from "fastify";
import websocket from "@fastify/websocket";
import WebSocket from "ws";
import OpenAI from "openai";

const POCKETWAVE_BOT_SECRET = process.env.POCKETWAVE_BOT_SECRET;

if (!POCKETWAVE_BOT_SECRET) {
  console.warn("POCKETWAVE_BOT_SECRET is not configured. Room relay is not protected.");
}

const app = Fastify({
  logger: true,
});

await app.register(websocket);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

type RoomClient = {
  socket: WebSocket;
  role: "viewer" | "producer";
};

const rooms = new Map<string, Set<RoomClient>>();

function joinRoom(roomId: string, client: RoomClient) {
  let room = rooms.get(roomId);

  if (!room) {
    room = new Set();
    rooms.set(roomId, room);
  }

  room.add(client);

  console.log(`Client joined room ${roomId} as ${client.role}`);
}

function leaveAllRooms(socket: WebSocket) {
  for (const [roomId, clients] of rooms.entries()) {
    for (const client of clients) {
      if (client.socket === socket) {
        clients.delete(client);
      }
    }

    if (clients.size === 0) {
      rooms.delete(roomId);
    }
  }
}

function broadcastToRoom(roomId: string, payload: unknown) {
  const room = rooms.get(roomId);

  if (!room) {
    return;
  }

  const message = JSON.stringify(payload);

  for (const client of room) {
    if (client.socket.readyState === WebSocket.OPEN) {
      client.socket.send(message);
    }
  }
}

type TranslationMode = "normal" | "tactical";

type ClientSettings = {
  sourceLanguage: string;
  targetLanguage: string;
  mode: TranslationMode;
};

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

  function connectDeepgram() {
    if (dgSocket) {
      dgSocket.close();
      dgSocket = null;
    }

    lastFinalTranscript = "";

    const dgUrl = buildDeepgramUrl(settings.sourceLanguage);

    dgSocket = new WebSocket(dgUrl, {
      headers: {
        Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`,
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

    leaveAllRooms(connection);

    if (dgSocket) {
      dgSocket.close();
    }
  });
});

await app.listen({
  port: Number(process.env.PORT ?? 4000),
  host: "0.0.0.0",
});