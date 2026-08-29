import type { ChatInputCommandInteraction } from "discord.js";
import { config } from "../config";

export async function handleHelp(interaction: ChatInputCommandInteraction) {
  await interaction.reply({
    content: [
      "🎧 **PocketWave Help**",
      `Version: \`${config.pocketwaveVersion}\``,
      "",
      "PocketWave translates Discord voice chat and shows subtitles in the desktop overlay.",
      "",
      "**Main commands:**",
      "",
      "`/setup` — setup guide",
      "`/status` — show current voice and translation status",
      "`/settings` — view or change active translation settings without restarting",
      "`/pair` — pair PocketWave Desktop with this server using a pairing code",
      "`/room` — show manual Room ID fallback",
      "`/join` — make the bot join your current voice channel",
      "`/transcribe` — start voice translation",
      "`/stop` — stop transcription",
      "`/leave` — make the bot leave the voice channel",
      "`/feedback` — send categorized feedback about PocketWave",
      "`/links` — show landing, download, Telegram and bot invite links",
      "",
      "**Recommended flow:**",
      "1. Desktop → Generate Pairing Code",
      "2. Discord → `/pair code: YOUR_CODE`",
      "3. Discord → `/join`",
      "4. Discord → `/transcribe from: English to: Ukrainian mode: Tactical`",
      "`voice: On` — translated speech is played in Discord",
"`voice: Off` — subtitles/text only",
      "",
      "**Tip:**",
      "If commands do not appear right after inviting the bot, wait 1–2 minutes or restart Discord.",
    ].join("\n"),
    ephemeral: true,
  });
}