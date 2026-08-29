import type { ChatInputCommandInteraction } from "discord.js";
import { activeGuildTranscribers } from "../voice/state";
import { stopGuildTts } from "../voice/tts";

export async function handleStop(interaction: ChatInputCommandInteraction) {
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
  stopGuildTts(interaction.guildId);

  await interaction.reply("PocketWave stopped transcribing.");
  console.log("Transcription stopped");
}