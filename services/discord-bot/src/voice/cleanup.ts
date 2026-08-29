import { getVoiceConnection } from "@discordjs/voice";

import {
  activeGuildTranscribers,
  activeSpeakerStreams,
  activeSubscriptions,
  activeApiSockets,
} from "./state";

import { stopGuildTts } from "./tts";

export function cleanupGuildVoiceSession(
  guildId: string,
  options?: {
    disconnect?: boolean;
  }
) {
  console.log("Cleaning PocketWave voice session:", guildId);

  const transcriber = activeGuildTranscribers.get(guildId);

  if (transcriber) {
    transcriber.stop();
  }

  const subscriptions = activeSubscriptions.get(guildId);

  if (subscriptions) {
    for (const stream of subscriptions) {
      try {
        stream.destroy();
      } catch (error) {
        console.error("Failed to destroy voice stream:", error);
      }
    }

    subscriptions.clear();
    activeSubscriptions.delete(guildId);
  }

  for (const key of activeSpeakerStreams) {
    if (key.startsWith(`${guildId}:`)) {
      activeSpeakerStreams.delete(key);
    }
  }

  const apiSockets = activeApiSockets.get(guildId);

if (apiSockets) {
  for (const socket of apiSockets) {
    try {
      socket.close();
    } catch (error) {
      console.error(
        "Failed to close PocketWave API socket:",
        error
      );
    }
  }

  apiSockets.clear();
  activeApiSockets.delete(guildId);
}

  stopGuildTts(guildId);

  if (options?.disconnect) {
    const connection = getVoiceConnection(guildId);

    if (connection) {
      connection.destroy();
    }
  }

  console.log("PocketWave voice session cleaned:", guildId);
}