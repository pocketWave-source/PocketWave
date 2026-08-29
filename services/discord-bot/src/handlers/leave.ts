import type { ChatInputCommandInteraction } from "discord.js";
import { getVoiceConnection } from "@discordjs/voice";
import { activeGuildTranscribers } from "../voice/state";
import { stopGuildTts } from "../voice/tts";

export async function handleLeave(interaction: ChatInputCommandInteraction) {
  if (!interaction.guildId) {
    await interaction.reply({
      content: "This command only works inside a server.",
      ephemeral: true,
    });
    return;
  }

  const transcriber = activeGuildTranscribers.get(interaction.guildId);

  if (transcriber) {
    transcriber.stop();
  }

  const connection = getVoiceConnection(interaction.guildId);

  if (!connection) {
    await interaction.reply({
      content: "PocketWave is not connected to a voice channel.",
      ephemeral: true,
    });
    return;
  }

  stopGuildTts(interaction.guildId);
  connection.destroy();

  await interaction.reply("PocketWave left the voice channel.");
  console.log("Left voice channel");
}