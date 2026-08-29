import Fastify from "fastify";
import websocket from "@fastify/websocket";
import { registerWebSocketRoute } from "./ws/route";

export async function createApiServer() {
  const app = Fastify();

  await app.register(websocket);

  app.get("/health", async () => {
    return {
      status: "ok",
      service: "pocketwave-api",
    };
  });

  registerWebSocketRoute(app);

  return app;
}