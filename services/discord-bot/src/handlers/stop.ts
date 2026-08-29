import {
  MessageFlags,
  type ChatInputCommandInteraction,
} from "discord.js";

import { activeGuildTranscribers } from "../voice/state";
import { cleanupGuildVoiceSession } from "../voice/cleanup";
import { publishRoomSessionState } from "../pocketwave/apiClient";

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

  const transcriber =
  activeGuildTranscribers.get(interaction.guildId);

if (!transcriber) {
  await interaction.reply({
    content:
      "PocketWave is not currently translating this server.",
    flags: MessageFlags.Ephemeral,
  });

  return;
}

const sessionSettings = {
  ...transcriber.settings,
};

await publishRoomSessionState(
  interaction.guildId,
  sessionSettings,
  false
).catch((error) => {
  console.error(
    "Failed to publish stopped session state:",
    error
  );
});

cleanupGuildVoiceSession(interaction.guildId);

await interaction.reply(
  "⏹️ PocketWave stopped translating. The bot remains in the voice channel."
);

  console.log("Translation stopped:", interaction.guildId);
}