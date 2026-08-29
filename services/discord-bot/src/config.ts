export const config = {
  discordToken: process.env.DISCORD_TOKEN,
  discordClientId: process.env.DISCORD_CLIENT_ID,
  discordGuildId: process.env.DISCORD_GUILD_ID,

  pocketwaveApiWsUrl: process.env.POCKETWAVE_API_WS_URL,
  pocketwaveBotSecret: process.env.POCKETWAVE_BOT_SECRET,
  pocketwaveVersion: process.env.POCKETWAVE_VERSION ?? "dev",

  feedbackChannelId: process.env.FEEDBACK_CHANNEL_ID,

  landingUrl: process.env.POCKETWAVE_LANDING_URL,
  downloadUrl: process.env.POCKETWAVE_DOWNLOAD_URL,
  telegramUrl: process.env.POCKETWAVE_TELEGRAM_URL,
  discordInviteUrl: process.env.POCKETWAVE_DISCORD_INVITE_URL,

  port: Number(process.env.PORT ?? 4001),
};

if (!config.discordToken || !config.discordClientId) {
  throw new Error("Missing DISCORD_TOKEN or DISCORD_CLIENT_ID");
}

if (!config.pocketwaveApiWsUrl) {
  throw new Error("POCKETWAVE_API_WS_URL is not defined");
}

if (!config.pocketwaveBotSecret) {
  console.warn("POCKETWAVE_BOT_SECRET is not configured.");
}