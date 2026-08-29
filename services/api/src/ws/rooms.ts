import WebSocket from "ws";
import type { RoomClient } from "../types";

const rooms = new Map<string, Set<RoomClient>>();

export function joinRoom(roomId: string, client: RoomClient) {
  let room = rooms.get(roomId);

  if (!room) {
    room = new Set();
    rooms.set(roomId, room);
  }

  room.add(client);

  console.log(`Client joined room ${roomId} as ${client.role}`);
}

export function leaveAllRooms(socket: WebSocket) {
  for (const [roomId, clients] of rooms.entries()) {
    for (const client of clients) {
      if (client.socket === socket) {
        clients.delete(client);
      }
    }

    if (clients.size === 0) {
      rooms.delete(roomId);
    }
  }
}

export function broadcastToRoom(roomId: string, payload: unknown) {
  const room = rooms.get(roomId);

  if (!room) {
    return;
  }

  const message = JSON.stringify(payload);

  for (const client of room) {
    if (client.socket.readyState === WebSocket.OPEN) {
      client.socket.send(message);
    }
  }
}