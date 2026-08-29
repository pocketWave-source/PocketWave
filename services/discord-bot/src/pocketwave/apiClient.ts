import WebSocket from "ws";
import { config } from "../config";

export function pairDesktopWithGuild(
  code: string,
  guildId: string,
  guildName: string
) {
  return new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(config.pocketwaveApiWsUrl!);

    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error("Pairing request timed out"));
    }, 7000);

    function finish(error?: Error) {
      clearTimeout(timeout);

      if (socket.readyState === WebSocket.OPEN) {
        socket.close();
      }

      if (error) {
        reject(error);
      } else {
        resolve();
      }
    }

    socket.on("open", () => {
      socket.send(
        JSON.stringify({
          type: "pair_room",
          botSecret: config.pocketwaveBotSecret,
          code: code.trim().toUpperCase(),
          roomId: guildId,
          guildName,
        })
      );
    });

    socket.on("message", (data) => {
      try {
        const payload = JSON.parse(data.toString());

        if (payload.type === "pairing_ok") {
          finish();
          return;
        }

        if (payload.type === "pairing_failed") {
          finish(new Error(payload.reason ?? "Pairing failed"));
          return;
        }

        if (payload.type === "error") {
          finish(new Error(payload.message ?? "API error"));
        }
      } catch (error) {
        finish(error instanceof Error ? error : new Error("Invalid API response"));
      }
    });

    socket.on("error", (error) => {
      finish(error instanceof Error ? error : new Error("Pairing socket error"));
    });
  });
}

export type RoomSessionState = {
  sourceLanguage: string;
  targetLanguage: string;
  mode: "normal" | "tactical";
  voiceEnabled: boolean;
};

export function publishRoomSessionState(
  guildId: string,
  settings: RoomSessionState,
  active: boolean
) {
  return new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(config.pocketwaveApiWsUrl!);

    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error("Session state request timed out"));
    }, 5000);

    function finish(error?: Error) {
      clearTimeout(timeout);

      if (
        socket.readyState === WebSocket.OPEN ||
        socket.readyState === WebSocket.CONNECTING
      ) {
        socket.close();
      }

      if (error) {
        reject(error);
      } else {
        resolve();
      }
    }

    socket.on("open", () => {
      socket.send(
        JSON.stringify({
          type: "room_session_state",

          botSecret: config.pocketwaveBotSecret,
          roomId: guildId,

          active,

          sourceLanguage: settings.sourceLanguage,
          targetLanguage: settings.targetLanguage,
          mode: settings.mode,
          voiceEnabled: settings.voiceEnabled,
        }),
        (error) => {
          if (error) {
            finish(error);
            return;
          }

          finish();
        }
      );
    });

    socket.on("error", (error) => {
      finish(
        error instanceof Error
          ? error
          : new Error("Session state socket error")
      );
    });
  });
}