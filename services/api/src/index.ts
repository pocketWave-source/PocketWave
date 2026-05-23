import Fastify from "fastify";
import websocket from "@fastify/websocket";
import WebSocket from "ws";
import OpenAI from "openai";

const app = Fastify({
  logger: true,
});

await app.register(websocket);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

app.get("/health", async () => {
  return { status: "ok" };
});

async function translateToUkrainian(text: string) {
  const response = await openai.responses.create({
    model: "gpt-4.1-mini",
    instructions:
      "Translate gaming voice chat into natural Ukrainian. Keep gaming terms short and clear. Return only the translation.",
    input: text,
  });

  return response.output_text;
}

app.get("/ws", { websocket: true }, (connection) => {
  console.log("Client connected");

  const dgSocket = new WebSocket(
    "wss://api.deepgram.com/v1/listen?model=nova-2&language=en&smart_format=true",
    {
      headers: {
        Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`,
      },
    }
  );

  dgSocket.on("open", () => {
    console.log("Deepgram connected");
  });

  dgSocket.on("message", async (data) => {
  const response = JSON.parse(data.toString());

  const transcript = response.channel?.alternatives?.[0]?.transcript;

  if (!transcript) return;

  console.log("Transcript:", transcript);

  const translated = await translateToUkrainian(transcript);

  connection.send(
    JSON.stringify({
      type: "translation",
      original: transcript,
      translated,
    })
  );
});

  dgSocket.on("error", (error) => {
    console.error("Deepgram error:", error);
  });

  connection.on("message", (message, isBinary) => {
    if (isBinary) {
      if (dgSocket.readyState === WebSocket.OPEN) {
        dgSocket.send(message);
      }

      return;
    }

    console.log("Text:", message.toString());
  });

  connection.on("close", () => {
    console.log("Client disconnected");

    dgSocket.close();
  });
});

await app.listen({
  port: 4000,
  host: "0.0.0.0",
});