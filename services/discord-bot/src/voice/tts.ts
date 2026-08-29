import { createAudioPlayer, createAudioResource, AudioPlayerStatus } from "@discordjs/voice";
import OpenAI from "openai";
import { Readable } from "node:stream";
import { config } from "../config";

const openai = new OpenAI({
  apiKey: config.openAiApiKey,
});

const ttsPlayersByGuild = new Map<string, ReturnType<typeof createAudioPlayer>>();
const ttsQueuesByGuild = new Map<string, Promise<void>>();

function bufferToStream(buffer: Buffer) {
  const stream = new Readable();

  stream.push(buffer);
  stream.push(null);

  return stream;
}

function getGuildTtsPlayer(guildId: string) {
  let player = ttsPlayersByGuild.get(guildId);

  if (!player) {
    player = createAudioPlayer();
    ttsPlayersByGuild.set(guildId, player);
  }

  return player;
}

async function generateTtsAudio(text: string) {
  const response = await openai.audio.speech.create({
    model: "gpt-4o-mini-tts",
    voice: config.ttsVoice,
    input: text.slice(0, 220),
    response_format: "mp3",
    speed: 1.08,
  });

  return Buffer.from(await response.arrayBuffer());
}

async function playTtsBuffer(guildId: string, audioBuffer: Buffer) {
  const { getVoiceConnection } = await import("@discordjs/voice");

  const connection = getVoiceConnection(guildId);

  if (!connection) {
    return;
  }

  const player = getGuildTtsPlayer(guildId);
  connection.subscribe(player);

  const resource = createAudioResource(bufferToStream(audioBuffer));

  await new Promise<void>((resolve) => {
    const cleanup = () => {
      player.off(AudioPlayerStatus.Idle, cleanup);
      resolve();
    };

    player.on(AudioPlayerStatus.Idle, cleanup);
    player.play(resource);
  });
}

export function queueTtsPlayback(guildId: string, text: string) {
  if (!config.ttsEnabled) {
    return;
  }

  const cleanText = text.trim();

  if (!cleanText) {
    return;
  }

  const currentQueue = ttsQueuesByGuild.get(guildId) ?? Promise.resolve();

  const nextQueue = currentQueue
    .then(async () => {
      const audioBuffer = await generateTtsAudio(cleanText);
      await playTtsBuffer(guildId, audioBuffer);
    })
    .catch((error) => {
      console.error("TTS playback failed:", error);
    });

  ttsQueuesByGuild.set(guildId, nextQueue);
}