import "dotenv/config";
import { config } from "./config";
import { createApiServer } from "./server";

const app = await createApiServer();

await app.listen({
  port: config.port,
  host: "0.0.0.0",
});