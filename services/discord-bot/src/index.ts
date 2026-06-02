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

const languages = [
  { name: "English", value: "en" },
  { name: "Ukrainian", value: "uk" },
  { name: "Polish", value: "pl" },
  { name: "German", value: "de" },
  { name: "Spanish", value: "es" },
  { name: "French", value: "fr" },
];

const translationModes = [
  { name: "Normal", value: "normal" },
  { name: "Tactical", value: "tactical" },
];

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
  .setDescription("Start listening and translating the current voice channel")
  .addStringOption((option) =>
    option
      .setName("from")
      .setDescription("Source language")
      .setRequired(false)
      .addChoices(...languages)
  )
  .addStringOption((option) =>
    option
      .setName("to")
      .setDescription("Target language")
      .setRequired(false)
      .addChoices(...languages)
  )
  .addStringOption((option) =>
    option
      .setName("mode")
      .setDescription("Translation mode")
      .setRequired(false)
      .addChoices(...translationModes)
  ),

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

const DISCORD_MESSAGE_COOLDOWN_MS = 2000;

const lastDiscordMessageAtByUser = new Map<string, number>();

type ActiveTranscriber = {
  stop: () => void;
};

const activeGuildTranscribers = new Map<string, ActiveTranscriber>();

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

await registerCommands();
await client.login(token);