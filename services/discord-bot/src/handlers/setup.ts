import type { ChatInputCommandInteraction } from "discord.js";
import { config } from "../config";

export async function handleSetup(interaction: ChatInputCommandInteraction) {
  if (!interaction.guildId) {
    await interaction.reply({
      content: "❌ This command can only be used inside a Discord server.",
      ephemeral: true,
    });
    return;
  }

  await interaction.reply({
    content: [
      "🎧 **PocketWave Setup**",
      `Version: \`${config.pocketwaveVersion}\``,
      "",
      "**Recommended setup: Pairing Code**",
      "",
      "1. Open **PocketWave Desktop**",
      "2. Select **Discord Voice**",
      "3. Click **Generate Pairing Code**",
      "4. In Discord, run:",
      "`/pair code: YOUR_CODE`",
      "",
      "After pairing, your desktop overlay will connect to this Discord server automatically.",
      "",
      "**Start translation:**",
"1. Join a Discord voice channel",
"2. Run:",
"`/transcribe from: English to: Ukrainian mode: Tactical voice: On`",
"",
"PocketWave will automatically join your voice channel.",
      "**Manual fallback:**",
      "If pairing does not work, use this Room ID in PocketWave Desktop:",
      `\`${interaction.guildId}\``,
      "",
      "Use `/feedback` if something is confusing or broken.",
    ].join("\n"),
    ephemeral: true,
  });
}