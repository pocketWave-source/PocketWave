import type { ChatInputCommandInteraction } from "discord.js";

export async function handleRoom(interaction: ChatInputCommandInteraction) {
  if (!interaction.guildId) {
    await interaction.reply({
      content: "❌ This command can only be used inside a Discord server.",
      ephemeral: true,
    });
    return;
  }

  await interaction.reply({
    content: [
      "🖥 **PocketWave Room ID**",
      "",
      "Manual fallback Room ID:",
      "",
      `\`${interaction.guildId}\``,
      "",
      "Recommended flow: use **Generate Pairing Code** in PocketWave Desktop and run `/pair code: YOUR_CODE`.",
    ].join("\n"),
    ephemeral: true,
  });
}