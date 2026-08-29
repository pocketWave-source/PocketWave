import type { ChatInputCommandInteraction } from "discord.js";
import { pairDesktopWithGuild } from "../pocketwave/apiClient";

export async function handlePair(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ ephemeral: true });

  if (!interaction.guildId) {
    await interaction.editReply("❌ This command can only be used inside a Discord server.");
    return;
  }

  const code = interaction.options.getString("code", true).trim().toUpperCase();

  if (code.length < 4 || code.length > 12) {
    await interaction.editReply("❌ Invalid pairing code.");
    return;
  }

  try {
    await pairDesktopWithGuild(
      code,
      interaction.guildId,
      interaction.guild?.name ?? "Unknown server"
    );

    await interaction.editReply([
      "✅ **PocketWave Desktop paired successfully!**",
      "",
      "Your desktop overlay is now connected to this Discord server.",
      "",
      "Next:",
      "`/join`",
      "`/transcribe from: English to: Ukrainian mode: Tactical`",
    ].join("\n"));
  } catch (error) {
    console.error("Pair command failed:", error);

    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    await interaction.editReply([
      "❌ Pairing failed.",
      "",
      `Debug reason: \`${errorMessage}\``,
      "",
      "Possible reasons:",
      "- the code is wrong",
      "- the code expired",
      "- PocketWave Desktop is not connected",
      "- API is sleeping or unavailable",
      "",
      "Generate a new code in PocketWave Desktop and try again.",
    ].join("\n"));
  }
}