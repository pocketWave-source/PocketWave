import "dotenv/config";
import Fastify from "fastify";
import websocket from "@fastify/websocket";
import { config } from "./config";


const app = Fastify({
  logger: true,
});

await app.register(websocket);


await app.listen({
  port: Number(config.port ?? 4000),
  host: "0.0.0.0",
});