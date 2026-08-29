import {
  MessageFlags,
  type ChatInputCommandInteraction,
} from "discord.js";

import { activeGuildTranscribers } from "../voice/state";
import { cleanupGuildVoiceSession } from "../voice/cleanup";

export async function handleStop(
  interaction: ChatInputCommandInteraction
) {
  if (!interaction.guildId) {
    await interaction.reply({
      content: "This command only works inside a server.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!activeGuildTranscribers.has(interaction.guildId)) {
    await interaction.reply({
      content:
        "PocketWave is not currently translating this server.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  cleanupGuildVoiceSession(interaction.guildId);

  await interaction.reply(
    "⏹️ PocketWave stopped translating. The bot remains in the voice channel."
  );

  console.log("Translation stopped:", interaction.guildId);
}