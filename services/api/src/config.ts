export const config = {
  port: Number(process.env.PORT ?? 4000),

  openAiApiKey: process.env.OPENAI_API_KEY,
  deepgramApiKey: process.env.DEEPGRAM_API_KEY,

  pocketwaveBotSecret: process.env.POCKETWAVE_BOT_SECRET,

  maxProducerSessionMs: Number(
    process.env.MAX_PRODUCER_SESSION_MS ?? 30 * 60 * 1000
  ),

  producerIdleTimeoutMs: Number(
    process.env.PRODUCER_IDLE_TIMEOUT_MS ?? 60 * 1000
  ),

  pairingTtlMs: Number(process.env.PAIRING_TTL_MS ?? 10 * 60 * 1000),
};

if (!config.pocketwaveBotSecret) {
  console.warn("POCKETWAVE_BOT_SECRET is not configured.");
}

if (!config.openAiApiKey) {
  console.warn("OPENAI_API_KEY is not configured.");
}

if (!config.deepgramApiKey) {
  console.warn("DEEPGRAM_API_KEY is not configured.");
}