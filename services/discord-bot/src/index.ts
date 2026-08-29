import "dotenv/config";
import {
  Client,
  GatewayIntentBits,
  PermissionFlagsBits,
} from "discord.js";
import {
    EndBehaviorType,
  getVoiceConnection,
} from "@discordjs/voice";

import type { Readable } from "node:stream";
import WebSocket from "ws";
import prism from "prism-media";
import Fastify from "fastify";
import { config } from "./config";
import { registerGuildCommands } from "./discord/registerCommands";
import { handlePing } from "./handlers/ping";
import { handleRoom } from "./handlers/room";
import { handleSetup } from "./handlers/setup";
import { handleHelp } from "./handlers/help";
import { handleLinks } from "./handlers/links";
import { handleFeedback } from "./handlers/feedback";
import { handlePair } from "./handlers/pair";
import { handleJoin } from "./handlers/join";
import { handleStop } from "./handlers/stop";
import { handleLeave } from "./handlers/leave";
import { activeGuildTranscribers } from "./voice/state";


const token = config.discordToken;
const clientId = config.discordClientId;
const guildId = config.discordGuildId;

const apiWsUrl = config.pocketwaveApiWsUrl!;
const POCKETWAVE_VERSION = config.pocketwaveVersion;
const POCKETWAVE_BOT_SECRET = config.pocketwaveBotSecret!;

if (!config.pocketwaveBotSecret) {
  throw new Error("POCKETWAVE_BOT_SECRET is not configured.");
}

const DISCORD_SAMPLE_RATE = 48000;
const TARGET_SAMPLE_RATE = 16000;
const DISCORD_CHANNELS = 2;

function createPocketWaveApiSocket(
  interaction: any,
  userId: string,
  sourceLanguage: string,
  targetLanguage: string,
  mode: string
) {
  const socket = new WebSocket(apiWsUrl);

  socket.on("open", () => {
    socket.send(
      JSON.stringify({
        type: "producer_auth",
        botSecret: POCKETWAVE_BOT_SECRET,
      })
    );
    console.log("Connected to PocketWave API WebSocket");

    socket.send(
  JSON.stringify({
    type: "settings",
    sourceLanguage,
    targetLanguage,
    mode,
  })
);
  });

  socket.on("message", async (message) => {
  try {
    const parsed = JSON.parse(message.toString()) as PocketWaveApiMessage;

    console.log("API message:", parsed);

    if (parsed.type === "translation") {
      await sendTranslationToDiscord(
        interaction,
        userId,
        parsed.original,
        parsed.translated
      );
      if (socket.readyState === WebSocket.OPEN) {
        const speakerName = await getSpeakerName(interaction, userId);

  socket.send(
    JSON.stringify({
      type: "room_translation",
      botSecret: POCKETWAVE_BOT_SECRET,
      roomId: interaction.guildId,
      userId,
      speakerName,
      original: parsed.original,
      translated: parsed.translated,
      mode: parsed.mode ?? "normal",
    })
  );
}
    }
  } catch (error) {
    console.error("Failed to handle API message:", error);
  }
});

  socket.on("error", (error) => {
    console.error("PocketWave API WebSocket error:", error);
  });

  socket.on("close", () => {
    console.log("PocketWave API WebSocket closed");
  });

  return socket;
}

type PocketWaveApiMessage =
  | {
      type: "translation";
      original: string;
      translated: string;
      mode?: "normal" | "tactical";
    }
  | {
      type: "transcript";
      text: string;
    }
  | {
      type: string;
      [key: string]: unknown;
    };

async function sendTranslationToDiscord(
  interaction: any,
  userId: string,
  original: string,
  translated: string
) {
  if (!interaction.channel || !interaction.channel.isTextBased()) {
    return;
  }

  if (!translated.trim()) {
    return;
  }

  const guildId = interaction.guildId;

  if (!guildId) {
  return;
}

if (!canSendDiscordTranslation(guildId, userId)) {
  return;
}

  const dedupeKey = `${userId}:${original}:${translated}`;

  if (lastTranslationByGuild.get(guildId) === dedupeKey) {
    return;
  }

  lastTranslationByGuild.set(guildId, dedupeKey);

  await interaction.channel.send({
    content:
      `🎧 **PocketWave** <@${userId}>\n` +
      `> ${original}\n` +
      `→ **${translated}**`,
    allowedMentions: {
      users: [],
    },
  });
}

function canSendDiscordTranslation(guildId: string, userId: string) {
  const key = `${guildId}:${userId}`;
  const now = Date.now();
  const lastSentAt = lastDiscordMessageAtByUser.get(key) ?? 0;

  if (now - lastSentAt < DISCORD_MESSAGE_COOLDOWN_MS) {
    return false;
  }

  lastDiscordMessageAtByUser.set(key, now);
  return true;
}

function stereo48kToMonoFloat32(chunk: Buffer) {
  const sampleCount = chunk.length / 2 / DISCORD_CHANNELS;
  const mono = new Float32Array(sampleCount);

  for (let i = 0; i < sampleCount; i += 1) {
    const left = chunk.readInt16LE(i * 4);
    const right = chunk.readInt16LE(i * 4 + 2);

    const mixed = (left + right) / 2;
    mono[i] = mixed / 32768;
  }

  return mono;
}

function downsampleFloat32(
  input: Float32Array,
  inputRate: number,
  outputRate: number
) {
  if (inputRate === outputRate) {
    return input;
  }

  const ratio = inputRate / outputRate;
  const outputLength = Math.floor(input.length / ratio);
  const output = new Float32Array(outputLength);

  for (let i = 0; i < outputLength; i += 1) {
    const start = Math.floor(i * ratio);
    const end = Math.floor((i + 1) * ratio);

    let sum = 0;
    let count = 0;

    for (let j = start; j < end && j < input.length; j += 1) {
      sum += input[j];
      count += 1;
    }

    output[i] = count > 0 ? sum / count : 0;
  }

  return output;
}

function float32ToInt16Buffer(input: Float32Array) {
  const output = Buffer.alloc(input.length * 2);

  for (let i = 0; i < input.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, input[i]));
    const int16 = sample < 0 ? sample * 0x8000 : sample * 0x7fff;

    output.writeInt16LE(int16, i * 2);
  }

  return output;
}

function convertDiscordPcmToDeepgramPcm(chunk: Buffer) {
  const mono48k = stereo48kToMonoFloat32(chunk);
  const mono16k = downsampleFloat32(
    mono48k,
    DISCORD_SAMPLE_RATE,
    TARGET_SAMPLE_RATE
  );

  return float32ToInt16Buffer(mono16k);
}

async function getSpeakerName(interaction: any, userId: string) {
  try {
    const member = await interaction.guild?.members.fetch(userId);

    if (member?.displayName) {
      return member.displayName;
    }
  } catch {
    // fallback below
  }

  try {
    const user = await interaction.client.users.fetch(userId);

    return user.displayName || user.username || `User ${userId}`;
  } catch {
    return `User ${userId}`;
  }
}

if (!token || !clientId) {
  throw new Error(
    "Missing DISCORD_TOKEN or DISCORD_CLIENT_ID"
  );
}

async function findWritableTextChannel(guild: any) {
  const me = guild.members.me ?? (await guild.members.fetchMe().catch(() => null));

  if (!me) {
    return null;
  }

  const canSend = (channel: any) => {
    if (!channel) return false;
    if (!channel.isTextBased?.()) return false;
    if (channel.isDMBased?.()) return false;
    if (!channel.permissionsFor) return false;

    const permissions = channel.permissionsFor(me);

    return (
      permissions?.has(PermissionFlagsBits.ViewChannel) &&
      permissions?.has(PermissionFlagsBits.SendMessages)
    );
  };

  if (guild.systemChannel && canSend(guild.systemChannel)) {
    return guild.systemChannel;
  }

  const channels = await guild.channels.fetch().catch(() => null);

  if (!channels) {
    return null;
  }

  for (const [, channel] of channels) {
    if (canSend(channel)) {
      return channel;
    }
  }

  return null;
}

async function sendGuildWelcomeMessage(guild: any) {
  const channel = await findWritableTextChannel(guild);

  if (!channel) {
    console.log(`No writable text channel found for guild ${guild.name} (${guild.id})`);
    return;
  }

  const landingUrl = config.landingUrl;
  const downloadUrl = config.downloadUrl;
  const telegramUrl = config.telegramUrl;

  await channel
    .send({
      content: [
        "🎧 **Thanks for inviting PocketWave!**",
        "",
        "PocketWave translates Discord voice chat and shows subtitles in the desktop overlay.",
        "",
        "**Start here:**",
        "`/setup` — setup guide and Room ID",
        "`/help` — list of commands",
        "`/links` — useful PocketWave links",
        "",
        "**Basic flow:**",
        "1. Open PocketWave Desktop",
        "2. Generate Pairing Code",
        "3. Run /pair code: YOUR_CODE",
        "4. Run `/join`",
        "5. Run `/transcribe`",
        "",
        landingUrl ? `🌊 Landing: ${landingUrl}` : null,
        downloadUrl ? `🖥 Download: ${downloadUrl}` : null,
        telegramUrl ? `📢 Telegram: ${telegramUrl}` : null,
        "",
        "If commands do not appear immediately, wait 1–2 minutes or restart Discord.",
      ]
        .filter(Boolean)
        .join("\n"),
      allowedMentions: { parse: [] },
    })
    .catch((error: any) => {
      console.error(`Failed to send welcome message to guild ${guild.id}:`, error);
    });
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

const activeSubscriptions = new Map<string, Set<Readable>>();
const lastTranslationByGuild = new Map<string, string>();

const DISCORD_MESSAGE_COOLDOWN_MS = 2000;

const lastDiscordMessageAtByUser = new Map<string, number>();

client.once("ready", async () => {
  console.log(`PocketWave Discord bot ${POCKETWAVE_VERSION} logged in as ${client.user?.tag}`);

for (const guild of client.guilds.cache.values()) {
  await registerGuildCommands(guild.id);
}
});

client.on("guildCreate", async (guild) => {
  console.log(`PocketWave was added to new guild: ${guild.name} (${guild.id})`);

  await registerGuildCommands(guild.id);
  await sendGuildWelcomeMessage(guild);
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) {
    return;
  }

  if (interaction.commandName === "ping") {
    await handlePing(interaction);
    return;
  }

  if (interaction.commandName === "room") {
    await handleRoom(interaction);
    return;
  }

if (interaction.commandName === "setup") {
    await handleSetup(interaction);
    return;
  }

if (interaction.commandName === "pair") {
    await handlePair(interaction);
    return;
  }

if (interaction.commandName === "help") {
    await handleHelp(interaction);
    return;
  }

if (interaction.commandName === "join") {
  await handleJoin(interaction);
  return;
}

  

  if (interaction.commandName === "transcribe") {
  if (!interaction.guildId || !interaction.guild) {
    await interaction.reply({
      content: "This command only works inside a server.",
      ephemeral: true,
    });
    return;
  }

  if (activeGuildTranscribers.has(interaction.guildId)) {
  await interaction.reply({
    content: "PocketWave is already transcribing this server. Use `/stop` first.",
    ephemeral: true,
  });
  return;
}

  const connection = getVoiceConnection(interaction.guildId);

  if (!connection) {
    await interaction.reply({
      content: "Use /join first so PocketWave can join your voice channel.",
      ephemeral: true,
    });
    return;
  }

  const sourceLanguage = interaction.options.getString("from") ?? "en";
const targetLanguage = interaction.options.getString("to") ?? "uk";

const mode = interaction.options.getString("mode") ?? "normal";

console.log("Transcribe settings:", {
  sourceLanguage,
  targetLanguage,
  mode,
});

  const receiver = connection.receiver;

  let guildSubscriptions = activeSubscriptions.get(interaction.guildId);

  if (!guildSubscriptions) {
    guildSubscriptions = new Set();
    activeSubscriptions.set(interaction.guildId, guildSubscriptions);
  }

  const handleSpeakingStart = (userId: string) => {
  console.log("User started speaking:", userId);

  const apiSocket = createPocketWaveApiSocket(
    interaction,
    userId,
    sourceLanguage,
    targetLanguage,
    mode
  );

  const opusStream = receiver.subscribe(userId, {
    end: {
      behavior: EndBehaviorType.AfterSilence,
      duration: 1000,
    },
  });

  const decoder = new prism.opus.Decoder({
    rate: DISCORD_SAMPLE_RATE,
    channels: DISCORD_CHANNELS,
    frameSize: 960,
  });

  guildSubscriptions.add(opusStream);

  let pcmChunkCount = 0;
  let pcmByteCount = 0;

  opusStream.pipe(decoder);

  decoder.on("data", (discordPcmChunk: Buffer) => {
    const deepgramPcmChunk = convertDiscordPcmToDeepgramPcm(discordPcmChunk);

    pcmChunkCount += 1;
    pcmByteCount += deepgramPcmChunk.length;

    if (apiSocket.readyState === WebSocket.OPEN) {
      apiSocket.send(deepgramPcmChunk);
    }

    if (pcmChunkCount % 50 === 0) {
      console.log(
        `Discord audio converted for ${userId}: ${pcmChunkCount} chunks, ${pcmByteCount} bytes`
      );
    }
  });

  decoder.on("error", (error: Error) => {
    console.error("Decoder error:", error);
  });

  opusStream.on("end", () => {
  console.log(
    `User stopped speaking: ${userId}. Converted chunks: ${pcmChunkCount}, bytes: ${pcmByteCount}`
  );

  decoder.destroy();
  guildSubscriptions?.delete(opusStream);

  if (apiSocket.readyState === WebSocket.OPEN) {
    apiSocket.send(
      JSON.stringify({
        type: "finalize",
      })
    );

    console.log("Sent finalize to PocketWave API");
  }

  setTimeout(() => {
    if (apiSocket.readyState === WebSocket.OPEN) {
      apiSocket.close();
      console.log("Closed PocketWave API socket after finalize delay");
    }
  }, 6000);
});

  opusStream.on("error", (error) => {
    console.error("Opus stream error:", error);

    decoder.destroy();
    apiSocket.close();
    guildSubscriptions?.delete(opusStream);
  });
};

receiver.speaking.on("start", handleSpeakingStart);

activeGuildTranscribers.set(interaction.guildId, {
  stop: () => {
    receiver.speaking.off("start", handleSpeakingStart);

    const guildSubscriptions = activeSubscriptions.get(interaction.guildId);

    if (guildSubscriptions) {
      for (const stream of guildSubscriptions) {
        stream.destroy();
      }

      guildSubscriptions.clear();
    }

    activeGuildTranscribers.delete(interaction.guildId);

    console.log("Active transcriber stopped for guild:", interaction.guildId);
  },
});

  await interaction.reply(
  `🎧 PocketWave is now listening: **${sourceLanguage} → ${targetLanguage}**, mode: **${mode}**. Use \`/stop\` to stop.`
);

  console.log("Transcription listener started");
  return;
}

if (interaction.commandName === "feedback") {
    await handleFeedback(interaction);
    return;
  }

if (interaction.commandName === "links") {
    await handleLinks(interaction);
    return;
  }

if (interaction.commandName === "stop") {
  await handleStop(interaction);
  return;
}

if (interaction.commandName === "leave") {
  await handleLeave(interaction);
  return;
}
});
const healthApp = Fastify();

healthApp.get("/health", async () => {
  return {
    status: "ok",
    service: "pocketwave-discord-bot",
  };
});

await healthApp.listen({
  port: Number(config.port),
  host: "0.0.0.0",
});

await client.login(token);