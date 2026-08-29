import type { ChatInputCommandInteraction } from "discord.js";
import { getVoiceConnection } from "@discordjs/voice";

import { config } from "../config";
import { activeGuildTranscribers } from "../voice/state";

const LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  uk: "Ukrainian",
  pl: "Polish",
  ru: "Russian",
  de: "German",
  fr: "French",
  es: "Spanish",
};

function getLanguageName(code: string) {
  return LANGUAGE_NAMES[code] ?? code;
}

function formatDuration(startedAt: number) {
  const totalSeconds = Math.max(
    0,
    Math.floor((Date.now() - startedAt) / 1000)
  );

  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes < 60) {
    return `${minutes}m ${seconds}s`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  return `${hours}h ${remainingMinutes}m`;
}

export async function handleStatus(
  interaction: ChatInputCommandInteraction
) {
  if (!interaction.guildId || !interaction.guild) {
    await interaction.reply({
      content: "❌ This command can only be used inside a Discord server.",
      ephemeral: true,
    });

    return;
  }

  const guildId = interaction.guildId;

  const connection = getVoiceConnection(guildId);
  const transcriber = activeGuildTranscribers.get(guildId);

  let voiceChannelName = "Not connected";

  if (connection) {
    const channelId = connection.joinConfig.channelId;

    if (channelId) {
      const channel = interaction.guild.channels.cache.get(channelId);

      voiceChannelName = channel?.name ?? "Connected";
    } else {
      voiceChannelName = "Connected";
    }
  }

  const lines = [
    "🎧 **PocketWave Status**",
    "",
    `Bot: ✅ Online`,
    `Voice channel: ${
      connection
        ? `✅ ${voiceChannelName}`
        : "❌ Not connected"
    }`,
    `Translation: ${
      transcriber
        ? "✅ Active"
        : "❌ Inactive"
    }`,
  ];

  if (transcriber) {
    lines.push(
      "",
      "**Translation session**",
      `From: **${getLanguageName(transcriber.settings.sourceLanguage)}**`,
      `To: **${getLanguageName(transcriber.settings.targetLanguage)}**`,
      `Mode: **${
        transcriber.settings.mode === "tactical"
          ? "Tactical"
          : "Normal"
      }**`,
      `Voice output: **${
        transcriber.settings.voiceEnabled
          ? "🔊 ON"
          : "🔇 OFF"
      }**`,
      `Running for: **${formatDuration(transcriber.startedAt)}**`
    );
  }

  lines.push(
    "",
    `Version: \`${config.pocketwaveVersion}\``
  );

  await interaction.reply({
    content: lines.join("\n"),
    ephemeral: true,
  });
}