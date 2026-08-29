import type { ChatInputCommandInteraction } from "discord.js";
import { EndBehaviorType, getVoiceConnection } from "@discordjs/voice";
import WebSocket from "ws";
import prism from "prism-media";
import { queueTtsPlayback } from "./tts";

import { config } from "../config";
import { convertDiscordPcmToDeepgramPcm, DISCORD_CHANNELS, DISCORD_SAMPLE_RATE } from "./audio";
import {
  activeGuildTranscribers,
  activeSubscriptions,
  DISCORD_MESSAGE_COOLDOWN_MS,
  lastDiscordMessageAtByUser,
  lastTranslationByGuild,
} from "./state";

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

function createPocketWaveApiSocket(
  interaction: ChatInputCommandInteraction,
  userId: string,
  sourceLanguage: string,
  targetLanguage: string,
  mode: string
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
              botSecret: config.pocketwaveBotSecret,
              roomId: interaction.guildId,
              userId,
              speakerName,
              original: parsed.original,
              translated: parsed.translated,
              mode: parsed.mode ?? "normal",
            })
          );
        }
        if (parsed.mode === "tactical" && interaction.guildId) {
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
    if (userId === interaction.client.user?.id) {
      return;
    }

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

    guildSubscriptions?.add(opusStream);

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

      const guildSubscriptions = activeSubscriptions.get(interaction.guildId!);

      if (guildSubscriptions) {
        for (const stream of guildSubscriptions) {
          stream.destroy();
        }

        guildSubscriptions.clear();
      }

      activeGuildTranscribers.delete(interaction.guildId!);

      console.log("Active transcriber stopped for guild:", interaction.guildId);
    },
  });

  await interaction.reply(
    `🎧 PocketWave is now listening: **${sourceLanguage} → ${targetLanguage}**, mode: **${mode}**. Use \`/stop\` to stop.`
  );

  console.log("Transcription listener started");
}