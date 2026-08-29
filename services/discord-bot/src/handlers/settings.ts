import {
  MessageFlags,
  type ChatInputCommandInteraction,
} from "discord.js";

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

function languageName(code: string) {
  return LANGUAGE_NAMES[code] ?? code;
}

export async function handleSettings(
  interaction: ChatInputCommandInteraction
) {
  if (!interaction.guildId) {
    await interaction.reply({
      content:
        "❌ This command can only be used inside a Discord server.",
      flags: MessageFlags.Ephemeral,
    });

    return;
  }

  const transcriber =
    activeGuildTranscribers.get(interaction.guildId);

  if (!transcriber) {
    await interaction.reply({
      content:
        "❌ Translation is not active. Start it first with `/transcribe`.",
      flags: MessageFlags.Ephemeral,
    });

    return;
  }

  const sourceLanguage =
    interaction.options.getString("from");

  const targetLanguage =
    interaction.options.getString("to");

  const mode =
    interaction.options.getString("mode");

  const voice =
    interaction.options.getString("voice");

  if (
    !sourceLanguage &&
    !targetLanguage &&
    !mode &&
    !voice
  ) {
    await interaction.reply({
      content: [
        "⚙️ **Current PocketWave Settings**",
        "",
        `From: **${languageName(
          transcriber.settings.sourceLanguage
        )}**`,
        `To: **${languageName(
          transcriber.settings.targetLanguage
        )}**`,
        `Mode: **${transcriber.settings.mode}**`,
        `Voice: **${
          transcriber.settings.voiceEnabled
            ? "🔊 ON"
            : "🔇 OFF"
        }**`,
      ].join("\n"),
      flags: MessageFlags.Ephemeral,
    });

    return;
  }

  if (sourceLanguage) {
    transcriber.settings.sourceLanguage =
      sourceLanguage;
  }

  if (targetLanguage) {
    transcriber.settings.targetLanguage =
      targetLanguage;
  }

  if (mode === "normal" || mode === "tactical") {
    transcriber.settings.mode = mode;
  }

  if (voice) {
    transcriber.settings.voiceEnabled =
      voice === "on";
  }

  console.log(
    "Translation settings changed:",
    interaction.guildId,
    transcriber.settings
  );

  await interaction.reply({
    content: [
      "✅ **PocketWave settings updated**",
      "",
      `From: **${languageName(
        transcriber.settings.sourceLanguage
      )}**`,
      `To: **${languageName(
        transcriber.settings.targetLanguage
      )}**`,
      `Mode: **${
        transcriber.settings.mode === "tactical"
          ? "Tactical"
          : "Normal"
      }**`,
      `Voice: **${
        transcriber.settings.voiceEnabled
          ? "🔊 ON"
          : "🔇 OFF"
      }**`,
      "",
      "Changes apply from the next spoken phrase.",
    ].join("\n"),

    flags: MessageFlags.Ephemeral,
  });
}