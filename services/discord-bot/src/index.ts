import "dotenv/config";
import {
  ChannelType,
  Client,
  GatewayIntentBits,
  PermissionFlagsBits,
} from "discord.js";
import {
    EndBehaviorType,
  getVoiceConnection,
  joinVoiceChannel,
} from "@discordjs/voice";

import type { Readable } from "node:stream";
import WebSocket from "ws";
import prism from "prism-media";
import Fastify from "fastify";
import { config } from "./config";
import { registerGuildCommands } from "./discord/registerCommands";


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

function pairDesktopWithGuild(code: string, guildId: string, guildName: string) {
  return new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(apiWsUrl);

    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error("Pairing request timed out"));
    }, 7000);

    function finish(error?: Error) {
      clearTimeout(timeout);

      if (socket.readyState === WebSocket.OPEN) {
        socket.close();
      }

      if (error) {
        reject(error);
      } else {
        resolve();
      }
    }

    socket.on("open", () => {
      socket.send(
        JSON.stringify({
          type: "pair_room",
          botSecret: POCKETWAVE_BOT_SECRET,
          code: code.trim().toUpperCase(),
          roomId: guildId,
          guildName,
        })
      );
    });

    socket.on("message", (data) => {
      try {
        const payload = JSON.parse(data.toString());

        if (payload.type === "pairing_ok") {
          finish();
          return;
        }

        if (payload.type === "pairing_failed") {
          finish(new Error(payload.reason ?? "Pairing failed"));
          return;
        }

        if (payload.type === "error") {
          finish(new Error(payload.message ?? "API error"));
        }
      } catch (error) {
        finish(error instanceof Error ? error : new Error("Invalid API response"));
      }
    });

    socket.on("error", (error) => {
      finish(error instanceof Error ? error : new Error("Pairing socket error"));
    });
  });
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

type ActiveTranscriber = {
  stop: () => void;
};

const activeGuildTranscribers = new Map<string, ActiveTranscriber>();

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
    await interaction.reply("PocketWave is online ✅");
    return;
  }

  if (interaction.commandName === "room") {
  if (!interaction.guildId) {
    await interaction.reply({
      content: "❌ This command can only be used inside a Discord server.",
      ephemeral: true,
    });
    return;
  }

  await interaction.reply({
    content: [
      "🖥 **PocketWave Room ID**",
      "",
      "Use this Room ID inside the PocketWave desktop overlay:",
      "",
      `\`${interaction.guildId}\``,
      "",
      "Open PocketWave Desktop → select **Discord Voice** → paste this Room ID → Connect.",
    ].join("\n"),
    ephemeral: true,
  });

  return;
}

if (interaction.commandName === "setup") {
  if (!interaction.guildId) {
    await interaction.reply({
      content: "❌ This command can only be used inside a Discord server.",
      ephemeral: true,
    });
    return;
  }

  await interaction.reply({
  content: [
    "🎧 **PocketWave Setup**",
    `Version: \`${POCKETWAVE_VERSION}\``,
    "",
    "**Recommended setup: Pairing Code**",
    "",
    "1. Open **PocketWave Desktop**",
    "2. Select **Discord Voice**",
    "3. Click **Generate Pairing Code**",
    "4. In Discord, run:",
    "`/pair code: YOUR_CODE`",
    "",
    "After pairing, your desktop overlay will connect to this Discord server automatically.",
    "",
    "**Then start translation:**",
    "`/join`",
    "`/transcribe from: English to: Ukrainian mode: Tactical`",
    "",
    "**Manual fallback:**",
    "If pairing does not work, use this Room ID in PocketWave Desktop:",
    `\`${interaction.guildId}\``,
    "",
    "Use `/feedback` if something is confusing or broken.",
  ].join("\n"),
  ephemeral: true,
});

  return;
}

if (interaction.commandName === "pair") {
  await interaction.deferReply({ ephemeral: true });

  if (!interaction.guildId) {
    await interaction.editReply("❌ This command can only be used inside a Discord server.");
    return;
  }

  const code = interaction.options.getString("code", true).trim().toUpperCase();

  if (code.length < 4 || code.length > 12) {
    await interaction.editReply("❌ Invalid pairing code.");
    return;
  }

  try {
    await pairDesktopWithGuild(
      code,
      interaction.guildId,
      interaction.guild?.name ?? "Unknown server"
    );

    await interaction.editReply([
      "✅ **PocketWave Desktop paired successfully!**",
      "",
      "Your desktop overlay is now connected to this Discord server.",
      "",
      "Next:",
      "`/join`",
      "`/transcribe from: English to: Ukrainian mode: Tactical`",
    ].join("\n"));
  } catch (error) {
    console.error("Pair command failed:", error);

    await interaction.editReply([
      "❌ Pairing failed.",
      "",
      "Possible reasons:",
      "- the code is wrong",
      "- the code expired",
      "- PocketWave Desktop is not connected",
      "- API is sleeping or unavailable",
      "",
      "Generate a new code in PocketWave Desktop and try again.",
    ].join("\n"));
  }

  return;
}

if (interaction.commandName === "help") {
  await interaction.reply({
    content: [
      "🎧 **PocketWave Help**",
      `Version: \`${POCKETWAVE_VERSION}\``,
      "",
      "PocketWave translates Discord voice chat and shows subtitles in the desktop overlay.",
      "",
      "**Main commands:**",
      "",
      "`/setup` — show setup instructions and Room ID",
      "`/pair` — pair PocketWave Desktop with this Discord server using a pairing code",
      "`/room` — show this server Room ID for the desktop overlay",
      "`/join` — make the bot join your current voice channel",
      "`/transcribe` — start voice translation",
      "`/stop` — stop transcription",
      "`/leave` — make the bot leave the voice channel",
      "`/feedback` — send categorized feedback about PocketWave",
      "`/links` — show landing, download, Telegram and bot invite links",
      "",
      "**Example:**",
      "`/join`",
      "`/transcribe from: English to: Ukrainian mode: Tactical`",
      "`/feedback category: Latency message: Overlay works, but translation delay is too high`",
      "",
      "**Desktop overlay:**",
      "Use **Generate Pairing Code** in PocketWave Desktop, then run `/pair code: YOUR_CODE` in Discord.",
      "Manual Room ID setup is still available with `/room` as fallback.",
      "",
      "**Tip:**",
      "If commands do not appear right after inviting the bot, wait 1–2 minutes or restart Discord.",
    ].join("\n"),
    ephemeral: true,
  });

  return;
}

  if (interaction.commandName === "join") {
    if (!interaction.guildId || !interaction.guild) {
      await interaction.reply({
        content: "This command only works inside a server.",
        ephemeral: true,
      });
      return;
    }

    const member = await interaction.guild.members.fetch(interaction.user.id);
    const voiceChannel = member.voice.channel;

    if (!voiceChannel || voiceChannel.type !== ChannelType.GuildVoice) {
      await interaction.reply({
        content: "Join a voice channel first.",
        ephemeral: true,
      });
      return;
    }

    joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: interaction.guildId,
      adapterCreator: interaction.guild.voiceAdapterCreator,
      selfDeaf: false,
      selfMute: true
    });

    await interaction.reply(
      `PocketWave joined **${voiceChannel.name}**. Translation is not active yet.`
    );

    console.log(`Joined voice channel: ${voiceChannel.name}`);
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
  await interaction.deferReply({ ephemeral: true });

  try {
    const category = interaction.options.getString("category", true);
    const feedback = interaction.options.getString("message", true).trim();

    if (feedback.length < 5) {
      await interaction.editReply("❌ Feedback is too short. Please write a bit more.");
      return;
    }

    if (feedback.length > 1500) {
      await interaction.editReply("❌ Feedback is too long. Please keep it under 1500 characters.");
      return;
    }

    const feedbackChannelId = config.feedbackChannelId;

    if (!feedbackChannelId) {
      await interaction.editReply("❌ Feedback channel is not configured yet.");
      return;
    }

    const feedbackChannel = await interaction.client.channels
      .fetch(feedbackChannelId)
      .catch((error) => {
        console.error("Failed to fetch feedback channel:", error);
        return null;
      });

    if (!feedbackChannel || !feedbackChannel.isTextBased()) {
      await interaction.editReply("❌ Feedback channel was not found or is not a text channel.");
      return;
    }

    const userTag = interaction.user.tag;
    const guildName = interaction.guild?.name ?? "Unknown server";

    await feedbackChannel.send({
  content: [
    "📝 **New PocketWave Feedback**",
    "",
    `**Category:** \`${category}\``,
    `**User:** ${userTag}`,
    `**Server:** ${guildName}`,
    `**User ID:** \`${interaction.user.id}\``,
    "",
    "**Message:**",
    feedback,
  ].join("\n"),
  allowedMentions: { users: [] },
});

    await interaction.editReply("✅ Thanks! Your feedback was sent to the PocketWave team.");
  } catch (error) {
    console.error("Feedback command failed:", error);

    await interaction.editReply(
      "❌ Something went wrong while sending feedback. Please try again later."
    );
  }

  return;
}

if (interaction.commandName === "links") {
  const landingUrl = config.landingUrl;
  const downloadUrl = config.downloadUrl;
  const telegramUrl = config.telegramUrl;
  const inviteUrl = config.discordInviteUrl;

  await interaction.reply({
    content: [
      "🔗 **PocketWave Links**",
      `Version: \`${POCKETWAVE_VERSION}\``,
      "",
      landingUrl ? `🌊 **Landing page:** ${landingUrl}` : null,
      downloadUrl ? `🖥 **Download Desktop:** ${downloadUrl}` : null,
      telegramUrl ? `📢 **Telegram:** ${telegramUrl}` : null,
      inviteUrl ? `🤖 **Invite Discord Bot:** ${inviteUrl}` : null,
      "",
      "Use `/setup` to get your Room ID and start the desktop overlay.",
    ]
      .filter(Boolean)
      .join("\n"),
    ephemeral: true,
  });

  return;
}

if (interaction.commandName === "stop") {
  if (!interaction.guildId) {
    await interaction.reply({
      content: "This command only works inside a server.",
      ephemeral: true,
    });
    return;
  }

  const transcriber = activeGuildTranscribers.get(interaction.guildId);

if (!transcriber) {
  await interaction.reply({
    content: "PocketWave is not currently transcribing this server.",
    ephemeral: true,
  });
  return;
}

transcriber.stop();

await interaction.reply("PocketWave stopped transcribing.");
console.log("Transcription stopped");
return;
}

  if (interaction.commandName === "leave") {
    if (!interaction.guildId) {
      await interaction.reply({
        content: "This command only works inside a server.",
        ephemeral: true,
      });
      return;
    }

    const connection = getVoiceConnection(interaction.guildId);

    if (!connection) {
      await interaction.reply({
        content: "PocketWave is not connected to a voice channel.",
        ephemeral: true,
      });
      return;
    }

    connection.destroy();

    await interaction.reply("PocketWave left the voice channel.");
    console.log("Left voice channel");
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