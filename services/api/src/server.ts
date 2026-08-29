import Fastify from "fastify";
import websocket from "@fastify/websocket";

export async function createApiServer() {
  const app = Fastify({
    logger: true,
  });

  await app.register(websocket);

app.get("/health", async () => {
  return { status: "ok" };
});

  return app;
}