import {
  ChannelType,
  type ChatInputCommandInteraction,
} from "discord.js";
import {
  EndBehaviorType,
  getVoiceConnection,
  joinVoiceChannel,
} from "@discordjs/voice";
import WebSocket from "ws";
import prism from "prism-media";
import { queueTtsPlayback } from "./tts";
import type { TranscriberSettings } from "./state";

import { config } from "../config";
import { convertDiscordPcmToDeepgramPcm, DISCORD_CHANNELS, DISCORD_SAMPLE_RATE } from "./audio";
import {
  activeGuildTranscribers,
  activeSubscriptions,
  activeSpeakerStreams,
  DISCORD_MESSAGE_COOLDOWN_MS,
  lastDiscordMessageAtByUser,
  lastTranslationByGuild,
  activeApiSockets
} from "./state";
import { publishRoomSessionState } from "../pocketwave/apiClient";

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

function isTranslationMessage(
  msg: PocketWaveApiMessage
): msg is { type: "translation"; original: string; translated: string; mode?: "normal" | "tactical" } {
  return (
    msg.type === "translation" &&
    typeof (msg as any).original === "string" &&
    typeof (msg as any).translated === "string"
  );
}

async function getSpeakerName(
  interaction: ChatInputCommandInteraction,
  userId: string
) {
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

async function sendTranslationToDiscord(
  interaction: ChatInputCommandInteraction,
  userId: string,
  original: string,
  translated: string
) {
  const channel = interaction.channel;

  if (!channel || !channel.isTextBased() || !("send" in channel)) {
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

  await channel.send({
    content:
      `🎧 **PocketWave** <@${userId}>\n` +
      `> ${original}\n` +
      `→ **${translated}**`,
    allowedMentions: {
      users: [],
    },
  });
}

function createPocketWaveApiSocket(
  interaction: ChatInputCommandInteraction,
  userId: string,
  sourceLanguage: string,
  targetLanguage: string,
  mode: string,
  voiceEnabled: boolean,
  onSttReady?: () => void
) {
  const socket = new WebSocket(config.pocketwaveApiWsUrl!);

  socket.on("open", () => {
    socket.send(
      JSON.stringify({
        type: "producer_auth",
        botSecret: config.pocketwaveBotSecret,
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

      if (parsed.type === "stt_ready") {
  console.log("PocketWave API STT ready");
  onSttReady?.();
  return;
}

      if (isTranslationMessage(parsed)) {
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
    botSecret: config.pocketwaveBotSecret,
    roomId: interaction.guildId,
    userId,
    speakerName,

    original: parsed.original,
    translated: parsed.translated,

    sourceLanguage,
    targetLanguage,
    mode: parsed.mode ?? mode,
    voiceEnabled,
  })
);
        }

        if (voiceEnabled && interaction.guildId) {
  queueTtsPlayback(interaction.guildId, parsed.translated);
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

export async function handleTranscribe(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();

  if (!interaction.guildId || !interaction.guild) {
    await interaction.editReply("This command only works inside a server.");
    return;
  }

  if (activeGuildTranscribers.has(interaction.guildId)) {
    await interaction.editReply({
      content: "PocketWave is already transcribing this server. Use `/stop` first.",
    });
    return;
  }

  let connection = getVoiceConnection(interaction.guildId);

if (!connection) {
  const member = await interaction.guild.members.fetch(
    interaction.user.id
  );

  const voiceChannel = member.voice.channel;

  if (
    !voiceChannel ||
    voiceChannel.type !== ChannelType.GuildVoice
  ) {
    await interaction.editReply(
      "❌ Join a voice channel first, then run `/transcribe` again."
    );

    return;
  }

  console.log(
    `Auto-joining voice channel ${voiceChannel.name} for /transcribe`
  );

  connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId: interaction.guildId,
    adapterCreator: interaction.guild.voiceAdapterCreator,

    // треба слухати користувачів
    selfDeaf: false,

    // треба мати можливість говорити через TTS
    selfMute: false,
  });
}

const member = await interaction.guild.members.fetch(
  interaction.user.id
);

const userVoiceChannel = member.voice.channel;

if (!userVoiceChannel) {
  await interaction.editReply(
    "❌ You need to be inside a voice channel."
  );

  return;
}

const sourceLanguage =
  interaction.options.getString("from") ?? "en";

const targetLanguage =
  interaction.options.getString("to") ?? "uk";

const mode =
  interaction.options.getString("mode") === "tactical"
    ? "tactical"
    : "normal";

const voiceEnabled =
  interaction.options.getString("voice") === "on";

const botChannelId = connection.joinConfig.channelId;

if (
  botChannelId &&
  botChannelId !== userVoiceChannel.id
) {
  const botChannel =
    interaction.guild.channels.cache.get(botChannelId);

  const channelId = connection.joinConfig.channelId;

  const connectedChannel = channelId
    ? interaction.guild.channels.cache.get(channelId)
    : null;

  await interaction.editReply(
    [
      "🎧 **PocketWave translation started**",
      "",
      `Voice channel: **${connectedChannel?.name ?? "Connected"}**`,
      `Language: **${sourceLanguage} → ${targetLanguage}**`,
      `Mode: **${mode === "tactical" ? "Tactical" : "Normal"}**`,
      `Voice output: **${voiceEnabled ? "🔊 ON" : "🔇 OFF"}**`,
      "",
      "`/settings` — change settings",
      "`/status` — check status",
      "`/stop` — stop translation",
    ].join("\n")
  );

  return;
}

const sessionSettings: TranscriberSettings = {
  sourceLanguage,
  targetLanguage,
  mode,
  voiceEnabled,
};

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
    if (userId === interaction.client.user?.id) {
      return;
    }

    const speakerKey = `${interaction.guildId}:${userId}`;

  if (activeSpeakerStreams.has(speakerKey)) {
    console.log("Speaker already has active stream, skipping:", speakerKey);
    return;
  }

  activeSpeakerStreams.add(speakerKey);

    console.log("User started speaking:", userId);

    const speakerNamePromise = getSpeakerName(
  interaction,
  userId
);

    let apiReady = false;
let speechEnded = false;
let finalizeSent = false;

const pendingAudioChunks: Buffer[] = [];
const MAX_PENDING_AUDIO_CHUNKS = 500; // приблизно 10 секунд аудіо

let apiSocket: WebSocket;

function flushPendingAudio() {
  if (apiSocket.readyState !== WebSocket.OPEN) {
    return;
  }

  if (pendingAudioChunks.length > 0) {
    console.log("Flushing buffered audio chunks:", pendingAudioChunks.length);
  }

  for (const chunk of pendingAudioChunks) {
    apiSocket.send(chunk);
  }

  pendingAudioChunks.length = 0;
}

function sendRoomSessionState(
  socket: WebSocket,
  interaction: ChatInputCommandInteraction,
  settings: TranscriberSettings,
  active: boolean
) {
  if (
    socket.readyState !== WebSocket.OPEN ||
    !interaction.guildId
  ) {
    return;
  }

  socket.send(
    JSON.stringify({
      type: "room_session_state",
      botSecret: config.pocketwaveBotSecret,

      roomId: interaction.guildId,

      active,

      sourceLanguage: settings.sourceLanguage,
      targetLanguage: settings.targetLanguage,
      mode: settings.mode,
      voiceEnabled: settings.voiceEnabled,
    })
  );
}

function sendFinalize() {
  if (finalizeSent) {
    return;
  }

  if (apiSocket.readyState !== WebSocket.OPEN) {
    return;
  }

  finalizeSent = true;

  flushPendingAudio();

  apiSocket.send(
    JSON.stringify({
      type: "finalize",
    })
  );

  console.log("Sent finalize to PocketWave API");

  setTimeout(() => {
    if (apiSocket.readyState === WebSocket.OPEN) {
      apiSocket.close();
      console.log("Closed PocketWave API socket after finalize delay");
    }
  }, 6000);
}

apiSocket = createPocketWaveApiSocket(
  interaction,
  userId,
  sessionSettings.sourceLanguage,
  sessionSettings.targetLanguage,
  sessionSettings.mode,
  sessionSettings.voiceEnabled,
  () => {
    apiReady = true;
    flushPendingAudio();

    sendRoomSessionState(
  apiSocket,
  interaction,
  sessionSettings,
  true
);

    if (speechEnded) {
      sendFinalize();
    }
  }
);

speakerNamePromise.then((speakerName) => {
  if (apiSocket.readyState !== WebSocket.OPEN) {
    return;
  }

  apiSocket.send(
    JSON.stringify({
      type: "room_speaking",
      botSecret: config.pocketwaveBotSecret,
      roomId: interaction.guildId,
      userId,
      speakerName,
      speaking: true,
    })
  );
});

let guildApiSockets =
  activeApiSockets.get(interaction.guildId);

if (!guildApiSockets) {
  guildApiSockets = new Set();
  activeApiSockets.set(
    interaction.guildId,
    guildApiSockets
  );
}

guildApiSockets.add(apiSocket);

apiSocket.on("close", () => {
  guildApiSockets?.delete(apiSocket);

  if (guildApiSockets?.size === 0) {
    activeApiSockets.delete(interaction.guildId!);
  }
});

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

    guildSubscriptions?.add(opusStream);

    let pcmChunkCount = 0;
    let pcmByteCount = 0;

    opusStream.pipe(decoder);

    decoder.on("data", (discordPcmChunk: Buffer) => {
      const deepgramPcmChunk = convertDiscordPcmToDeepgramPcm(discordPcmChunk);

      pcmChunkCount += 1;
      pcmByteCount += deepgramPcmChunk.length;

      if (apiReady && apiSocket.readyState === WebSocket.OPEN) {
  apiSocket.send(deepgramPcmChunk);
} else {
  pendingAudioChunks.push(deepgramPcmChunk);

  if (pendingAudioChunks.length > MAX_PENDING_AUDIO_CHUNKS) {
    pendingAudioChunks.shift();
  }

  if (pcmChunkCount <= 5 || pcmChunkCount % 50 === 0) {
    console.log("Buffered audio chunk until STT ready:", {
      chunks: pendingAudioChunks.length,
      socketState: apiSocket.readyState,
      apiReady,
    });
  }
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

      speakerNamePromise.then((speakerName) => {
  if (apiSocket.readyState !== WebSocket.OPEN) {
    return;
  }

  apiSocket.send(
    JSON.stringify({
      type: "room_speaking",
      botSecret: config.pocketwaveBotSecret,
      roomId: interaction.guildId,
      userId,
      speakerName,
      speaking: false,
    })
  );
});

      activeSpeakerStreams.delete(speakerKey);

      decoder.destroy();
      guildSubscriptions?.delete(opusStream);

      speechEnded = true;

if (apiReady) {
  sendFinalize();
} else {
  console.log("Speech ended before STT ready; waiting to flush audio");

  setTimeout(() => {
    if (!finalizeSent) {
      console.log("Forcing finalize after waiting for STT ready");
      sendFinalize();
    }
  }, 5000);
}
    });

    opusStream.on("error", (error) => {
      console.error("Opus stream error:", error);

      activeSpeakerStreams.delete(speakerKey);
      pendingAudioChunks.length = 0;

      decoder.destroy();
      apiSocket.close();
      guildSubscriptions?.delete(opusStream);
    });
  };

  receiver.speaking.on("start", handleSpeakingStart);

  activeGuildTranscribers.set(interaction.guildId, {
  settings: sessionSettings,
  startedAt: Date.now(),

  notifySettingsChanged: () => {
  if (apiSocket?.readyState === WebSocket.OPEN) {
    sendRoomSessionState(
      apiSocket,
      interaction,
      sessionSettings,
      true
    );
  }
},

  stop: () => {
    receiver.speaking.off("start", handleSpeakingStart);

    activeGuildTranscribers.delete(interaction.guildId!);

    console.log(
      "Transcription listener removed:",
      interaction.guildId
    );
  },
});

void publishRoomSessionState(
  interaction.guildId,
  sessionSettings,
  true
).catch((error) => {
  console.error(
    "Failed to publish active session state:",
    error
  );
});

  await interaction.editReply(
  [
    "🎧 **PocketWave translation started**",
    "",
    `Language: **${sourceLanguage} → ${targetLanguage}**`,
    `Mode: **${mode}**`,
    `Voice translation: **${voiceEnabled ? "ON 🔊" : "OFF 🔇"}**`,
    "",
    "Use `/stop` to stop.",
  ].join("\n")
);

  console.log("Transcription listener started");
}