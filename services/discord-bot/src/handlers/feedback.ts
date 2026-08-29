import type { ChatInputCommandInteraction } from "discord.js";
import { config } from "../config";

export async function handleFeedback(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ ephemeral: true });

  try {
    const category = interaction.options.getString("category", true);
    const feedback = interaction.options.getString("message", true).trim();

    if (feedback.length < 5) {
      await interaction.editReply("❌ Feedback is too short. Please write a bit more.");
      return;
    }

    if (feedback.length > 1500) {
      await interaction.editReply("❌ Feedback is too long. Please keep it under 1500 characters.");
      return;
    }

    const feedbackChannelId = config.feedbackChannelId;

    if (!feedbackChannelId) {
      await interaction.editReply("❌ Feedback channel is not configured yet.");
      return;
    }

    const feedbackChannel = await interaction.client.channels
      .fetch(feedbackChannelId)
      .catch((error) => {
        console.error("Failed to fetch feedback channel:", error);
        return null;
      });

    if (!feedbackChannel || !feedbackChannel.isTextBased()) {
      await interaction.editReply("❌ Feedback channel was not found or is not a text channel.");
      return;
    }

    const userTag = interaction.user.tag;
    const guildName = interaction.guild?.name ?? "Unknown server";

    if (!feedbackChannel.isSendable()) {
      await interaction.editReply("❌ Feedback channel is not writable.");
      return;
    }

    await feedbackChannel.send({
      content: [
        "📝 **New PocketWave Feedback**",
        "",
        `**Category:** \`${category}\``,
        `**User:** ${userTag}`,
        `**Server:** ${guildName}`,
        `**User ID:** \`${interaction.user.id}\``,
        "",
        "**Message:**",
        feedback,
      ].join("\n"),
      allowedMentions: { users: [] },
    });

    await interaction.editReply("✅ Thanks! Your feedback was sent to the PocketWave team.");
  } catch (error) {
    console.error("Feedback command failed:", error);

    await interaction.editReply(
      "❌ Something went wrong while sending feedback. Please try again later."
    );
  }
}