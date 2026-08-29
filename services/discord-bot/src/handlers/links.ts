import type { ChatInputCommandInteraction } from "discord.js";
import { config } from "../config";

export async function handleLinks(interaction: ChatInputCommandInteraction) {
  await interaction.reply({
    content: [
      "🔗 **PocketWave Links**",
      `Version: \`${config.pocketwaveVersion}\``,
      "",
      config.landingUrl ? `🌊 **Landing page:** ${config.landingUrl}` : null,
      config.downloadUrl ? `🖥 **Download Desktop:** ${config.downloadUrl}` : null,
      config.telegramUrl ? `📢 **Telegram:** ${config.telegramUrl}` : null,
      config.discordInviteUrl ? `🤖 **Invite Discord Bot:** ${config.discordInviteUrl}` : null,
      "",
      "Use `/setup` to start.",
    ]
      .filter(Boolean)
      .join("\n"),
    ephemeral: true,
  });
}