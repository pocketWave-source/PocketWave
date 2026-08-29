import {
  MessageFlags,
  type ChatInputCommandInteraction,
} from "discord.js";

import { getVoiceConnection } from "@discordjs/voice";
import { cleanupGuildVoiceSession } from "../voice/cleanup";
import { activeGuildTranscribers } from "../voice/state";
import { publishRoomSessionState } from "../pocketwave/apiClient";

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

  const transcriber =
  activeGuildTranscribers.get(interaction.guildId);

if (transcriber) {
  await publishRoomSessionState(
    interaction.guildId,
    transcriber.settings,
    false
  ).catch((error) => {
    console.error(
      "Failed to publish stopped session state:",
      error
    );
  });
}

  cleanupGuildVoiceSession(interaction.guildId, {
    disconnect: true,
  });

  await interaction.reply(
    "👋 PocketWave stopped translation and left the voice channel."
  );

  console.log("PocketWave left guild:", interaction.guildId);
}