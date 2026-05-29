import "dotenv/config";
import {
  ChannelType,
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
} from "discord.js";
import {
    EndBehaviorType,
  getVoiceConnection,
  joinVoiceChannel,
} from "@discordjs/voice";

import type { Readable } from "node:stream";
import WebSocket from "ws";
import prism from "prism-media";

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.DISCORD_GUILD_ID;

const apiWsUrl = process.env.POCKETWAVE_API_WS_URL ?? "ws://api:4000/ws";

const DISCORD_SAMPLE_RATE = 48000;
const TARGET_SAMPLE_RATE = 16000;
const DISCORD_CHANNELS = 2;

function createPocketWaveApiSocket(interaction: any, userId: string) {
  const socket = new WebSocket(apiWsUrl);

  socket.on("open", () => {
    console.log("Connected to PocketWave API WebSocket");

    socket.send(
      JSON.stringify({
        type: "settings",
        sourceLanguage: "en",
        targetLanguage: "uk",
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
  socket.send(
    JSON.stringify({
      type: "room_translation",
      roomId: interaction.guildId,
      userId,
      original: parsed.original,
      translated: parsed.translated,
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

if (!token || !clientId || !guildId) {
  throw new Error(
    "Missing DISCORD_TOKEN, DISCORD_CLIENT_ID or DISCORD_GUILD_ID"
  );
}

const commands = [
  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Check if PocketWave bot is alive"),

  new SlashCommandBuilder()
    .setName("join")
    .setDescription("Join your current voice channel"),

  new SlashCommandBuilder()
    .setName("leave")
    .setDescription("Leave the current voice channel"),

  new SlashCommandBuilder()
    .setName("transcribe")
    .setDescription("Start listening to the current voice channel"),

  new SlashCommandBuilder()
    .setName("stop")
    .setDescription("Stop listening to the current voice channel"),
].map((command) => command.toJSON());

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(token);

  await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
    body: commands,
  });

  console.log("Slash commands registered");
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

const activeSubscriptions = new Map<string, Set<Readable>>();
const lastTranslationByGuild = new Map<string, string>();

client.once("ready", () => {
  console.log(`PocketWave Discord bot logged in as ${client.user?.tag}`);
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) {
    return;
  }

  if (interaction.commandName === "ping") {
    await interaction.reply("PocketWave is online ✅");
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

  const connection = getVoiceConnection(interaction.guildId);

  if (!connection) {
    await interaction.reply({
      content: "Use /join first so PocketWave can join your voice channel.",
      ephemeral: true,
    });
    return;
  }

  const receiver = connection.receiver;

  let guildSubscriptions = activeSubscriptions.get(interaction.guildId);

  if (!guildSubscriptions) {
    guildSubscriptions = new Set();
    activeSubscriptions.set(interaction.guildId, guildSubscriptions);
  }

  receiver.speaking.on("start", (userId) => {
  console.log("User started speaking:", userId);

  const apiSocket = createPocketWaveApiSocket(interaction, userId);

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
    const deepgramPcmChunk =
      convertDiscordPcmToDeepgramPcm(discordPcmChunk);

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
    apiSocket.close();
    guildSubscriptions?.delete(opusStream);
  });

  opusStream.on("error", (error) => {
    console.error("Opus stream error:", error);

    decoder.destroy();
    apiSocket.close();
    guildSubscriptions?.delete(opusStream);
  });
});

  await interaction.reply(
  "🎧 PocketWave is now listening and translating this voice channel. Use `/stop` to stop."
);

  console.log("Transcription listener started");
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

  const guildSubscriptions = activeSubscriptions.get(interaction.guildId);

  if (!guildSubscriptions || guildSubscriptions.size === 0) {
    await interaction.reply({
      content: "PocketWave is not currently listening.",
      ephemeral: true,
    });
    return;
  }

  for (const stream of guildSubscriptions) {
    stream.destroy();
  }

  guildSubscriptions.clear();

  await interaction.reply("PocketWave stopped listening.");
  console.log("Transcription listener stopped");
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

await registerCommands();
await client.login(token);