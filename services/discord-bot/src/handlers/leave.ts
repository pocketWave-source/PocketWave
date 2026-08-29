import {
  MessageFlags,
  type ChatInputCommandInteraction,
} from "discord.js";

import { getVoiceConnection } from "@discordjs/voice";
import { cleanupGuildVoiceSession } from "../voice/cleanup";

export async function handleLeave(
  interaction: ChatInputCommandInteraction
) {
  if (!interaction.guildId) {
    await interaction.reply({
      content: "This command only works inside a server.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const connection = getVoiceConnection(interaction.guildId);

  if (!connection) {
    await interaction.reply({
      content:
        "PocketWave is not connected to a voice channel.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  cleanupGuildVoiceSession(interaction.guildId, {
    disconnect: true,
  });

  await interaction.reply(
    "👋 PocketWave stopped translation and left the voice channel."
  );

  console.log("PocketWave left guild:", interaction.guildId);
}