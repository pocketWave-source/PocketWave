import {
  AudioPlayerStatus,
  createAudioPlayer,
  createAudioResource,
  getVoiceConnection,
} from "@discordjs/voice";

import OpenAI from "openai";
import { Readable } from "node:stream";
import { config } from "../config";

const openai = new OpenAI({
  apiKey: config.openAiApiKey,
});

const MIN_TTS_GAP_MS = 1800;
const DUPLICATE_WINDOW_MS = 5000;
const MAX_QUEUE_SIZE = 3;

type GuildTtsState = {
  queue: string[];
  processing: boolean;
  lastPlayedAt: number;
  lastText: string;
  lastTextAt: number;
};

const playersByGuild = new Map<
  string,
  ReturnType<typeof createAudioPlayer>
>();

const statesByGuild = new Map<string, GuildTtsState>();

function getGuildState(guildId: string): GuildTtsState {
  let state = statesByGuild.get(guildId);

  if (!state) {
    state = {
      queue: [],
      processing: false,
      lastPlayedAt: 0,
      lastText: "",
      lastTextAt: 0,
    };

    statesByGuild.set(guildId, state);
  }

  return state;
}

function getGuildPlayer(guildId: string) {
  let player = playersByGuild.get(guildId);

  if (!player) {
    player = createAudioPlayer();

    player.on("error", (error) => {
      console.error(`TTS player error for guild ${guildId}:`, error);
    });

    playersByGuild.set(guildId, player);
  }

  return player;
}

function bufferToStream(buffer: Buffer) {
  const stream = new Readable({
    read() {},
  });

  stream.push(buffer);
  stream.push(null);

  return stream;
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function generateTtsAudio(text: string) {
  console.log("Generating TTS:", text);

  const response = await openai.audio.speech.create({
    model: "gpt-4o-mini-tts",
    voice: config.ttsVoice as any,
    input: text.slice(0, 220),
    response_format: "mp3",
    speed: 1.08,
  });

  const buffer = Buffer.from(await response.arrayBuffer());

  console.log("TTS generated:", buffer.length, "bytes");

  return buffer;
}

async function playTtsBuffer(guildId: string, audioBuffer: Buffer) {
  const connection = getVoiceConnection(guildId);

  if (!connection) {
    console.log("TTS skipped: no voice connection:", guildId);
    return;
  }

  const player = getGuildPlayer(guildId);

  connection.subscribe(player);

  const resource = createAudioResource(
    bufferToStream(audioBuffer)
  );

  await new Promise<void>((resolve, reject) => {
    const onIdle = () => {
      cleanup();
      resolve();
    };

    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    const cleanup = () => {
      player.off(AudioPlayerStatus.Idle, onIdle);
      player.off("error", onError);
    };

    player.once(AudioPlayerStatus.Idle, onIdle);
    player.once("error", onError);

    player.play(resource);
  });
}

async function processGuildQueue(guildId: string) {
  const state = getGuildState(guildId);

  if (state.processing) {
    return;
  }

  state.processing = true;

  try {
    while (state.queue.length > 0) {
      const text = state.queue.shift();

      if (!text) {
        continue;
      }

      const elapsed = Date.now() - state.lastPlayedAt;

      if (elapsed < MIN_TTS_GAP_MS) {
        const waitMs = MIN_TTS_GAP_MS - elapsed;

        console.log(`TTS cooldown: waiting ${waitMs}ms`);

        await sleep(waitMs);
      }

      const audioBuffer = await generateTtsAudio(text);

      await playTtsBuffer(guildId, audioBuffer);

      state.lastPlayedAt = Date.now();

      console.log("TTS playback completed:", text);
    }
  } catch (error) {
    console.error("TTS queue processing failed:", error);
  } finally {
    state.processing = false;

    // Щось могло прийти саме між while і finally.
    if (state.queue.length > 0) {
      void processGuildQueue(guildId);
    }
  }
}

export function queueTtsPlayback(
  guildId: string,
  text: string
) {
  if (!config.ttsEnabled) {
    return;
  }

  const cleanText = text.trim();

  if (!cleanText) {
    return;
  }

  const state = getGuildState(guildId);
  const now = Date.now();

  // Не повторюємо ту саму фразу кілька разів.
  if (
    state.lastText === cleanText &&
    now - state.lastTextAt < DUPLICATE_WINDOW_MS
  ) {
    console.log("TTS duplicate skipped:", cleanText);
    return;
  }

  state.lastText = cleanText;
  state.lastTextAt = now;

  // Для tactical старий callout краще викинути,
  // ніж озвучити його через 10 секунд.
  if (state.queue.length >= MAX_QUEUE_SIZE) {
    const removed = state.queue.shift();

    console.log("TTS queue full, dropping old phrase:", removed);
  }

  state.queue.push(cleanText);

  console.log("TTS queued:", {
    guildId,
    text: cleanText,
    queueSize: state.queue.length,
  });

  void processGuildQueue(guildId);
}

export function stopGuildTts(guildId: string) {
  const state = statesByGuild.get(guildId);

  if (state) {
    state.queue.length = 0;
    state.processing = false;
  }

  const player = playersByGuild.get(guildId);

  if (player) {
    player.stop(true);
  }

  console.log("TTS stopped and queue cleared:", guildId);
}