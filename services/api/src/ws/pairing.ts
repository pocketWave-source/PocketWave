import crypto from "node:crypto";
import WebSocket from "ws";
import type { PairingSession } from "../types";

const pairingSessions = new Map<string, PairingSession>();

function safeSend(socket: WebSocket, payload: unknown) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

function generatePairingCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";

  for (let i = 0; i < 6; i += 1) {
    code += alphabet[crypto.randomInt(0, alphabet.length)];
  }

  return code;
}

export function createPairingSession(socket: WebSocket, ttlMs: number) {
  let code = generatePairingCode();

  while (pairingSessions.has(code)) {
    code = generatePairingCode();
  }

  const timer = setTimeout(() => {
    pairingSessions.delete(code);

    safeSend(socket, {
      type: "pairing_expired",
      code,
    });
  }, ttlMs);

  const session: PairingSession = {
    code,
    socket,
    expiresAt: Date.now() + ttlMs,
    timer,
  };

  pairingSessions.set(code, session);

  return session;
}

export function consumePairingSession(code: string) {
  const normalizedCode = code.trim().toUpperCase();
  const session = pairingSessions.get(normalizedCode);

  if (!session) {
    return null;
  }

  pairingSessions.delete(normalizedCode);
  clearTimeout(session.timer);

  if (session.expiresAt < Date.now()) {
    return null;
  }

  if (session.socket.readyState !== WebSocket.OPEN) {
    return null;
  }

  return session;
}

export function removePairingSessionsForSocket(socket: WebSocket) {
  for (const [code, session] of pairingSessions.entries()) {
    if (session.socket === socket) {
      clearTimeout(session.timer);
      pairingSessions.delete(code);
    }
  }
}