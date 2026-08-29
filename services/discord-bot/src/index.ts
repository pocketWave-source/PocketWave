import "dotenv/config";
import {
  Client,
  GatewayIntentBits,
  PermissionFlagsBits,
} from "discord.js";

import Fastify from "fastify";
import { config } from "./config";
import { registerGuildCommands } from "./discord/registerCommands";
import { handlePing } from "./handlers/ping";
import { handleRoom } from "./handlers/room";
import { handleSetup } from "./handlers/setup";
import { handleHelp } from "./handlers/help";
import { handleLinks } from "./handlers/links";
import { handleFeedback } from "./handlers/feedback";
import { handlePair } from "./handlers/pair";
import { handleJoin } from "./handlers/join";
import { handleStop } from "./handlers/stop";
import { handleLeave } from "./handlers/leave";
import { handleTranscribe } from "./voice/transcription";

const token = config.discordToken;
const clientId = config.discordClientId;

const POCKETWAVE_VERSION = config.pocketwaveVersion;

if (!config.pocketwaveBotSecret) {
  throw new Error("POCKETWAVE_BOT_SECRET is not configured.");
}

if (!token || !clientId) {
  throw new Error(
    "Missing DISCORD_TOKEN or DISCORD_CLIENT_ID"
  );
}

async function findWritableTextChannel(guild: any) {
  const me = guild.members.me ?? (await guild.members.fetchMe().catch(() => null));

  if (!me) {
    return null;
  }

  const canSend = (channel: any) => {
    if (!channel) return false;
    if (!channel.isTextBased?.()) return false;
    if (channel.isDMBased?.()) return false;
    if (!channel.permissionsFor) return false;

    const permissions = channel.permissionsFor(me);

    return (
      permissions?.has(PermissionFlagsBits.ViewChannel) &&
      permissions?.has(PermissionFlagsBits.SendMessages)
    );
  };

  if (guild.systemChannel && canSend(guild.systemChannel)) {
    return guild.systemChannel;
  }

  const channels = await guild.channels.fetch().catch(() => null);

  if (!channels) {
    return null;
  }

  for (const [, channel] of channels) {
    if (canSend(channel)) {
      return channel;
    }
  }

  return null;
}

async function sendGuildWelcomeMessage(guild: any) {
  const channel = await findWritableTextChannel(guild);

  if (!channel) {
    console.log(`No writable text channel found for guild ${guild.name} (${guild.id})`);
    return;
  }

  const landingUrl = config.landingUrl;
  const downloadUrl = config.downloadUrl;
  const telegramUrl = config.telegramUrl;

  await channel
    .send({
      content: [
        "🎧 **Thanks for inviting PocketWave!**",
        "",
        "PocketWave translates Discord voice chat and shows subtitles in the desktop overlay.",
        "",
        "**Start here:**",
        "`/setup` — setup guide and Room ID",
        "`/help` — list of commands",
        "`/links` — useful PocketWave links",
        "",
        "**Basic flow:**",
        "1. Open PocketWave Desktop",
        "2. Generate Pairing Code",
        "3. Run /pair code: YOUR_CODE",
        "4. Run `/join`",
        "5. Run `/transcribe`",
        "",
        landingUrl ? `🌊 Landing: ${landingUrl}` : null,
        downloadUrl ? `🖥 Download: ${downloadUrl}` : null,
        telegramUrl ? `📢 Telegram: ${telegramUrl}` : null,
        "",
        "If commands do not appear immediately, wait 1–2 minutes or restart Discord.",
      ]
        .filter(Boolean)
        .join("\n"),
      allowedMentions: { parse: [] },
    })
    .catch((error: any) => {
      console.error(`Failed to send welcome message to guild ${guild.id}:`, error);
    });
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

client.once("ready", async () => {
  console.log(`PocketWave Discord bot ${POCKETWAVE_VERSION} logged in as ${client.user?.tag}`);

for (const guild of client.guilds.cache.values()) {
  await registerGuildCommands(guild.id);
}
});

client.on("guildCreate", async (guild) => {
  console.log(`PocketWave was added to new guild: ${guild.name} (${guild.id})`);

  await registerGuildCommands(guild.id);
  await sendGuildWelcomeMessage(guild);
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) {
    return;
  }

  try {
    if (interaction.commandName === "ping") {
      await handlePing(interaction);
      return;
    }

    if (interaction.commandName === "room") {
      await handleRoom(interaction);
      return;
    }

    if (interaction.commandName === "setup") {
      await handleSetup(interaction);
      return;
    }

    if (interaction.commandName === "pair") {
      await handlePair(interaction);
      return;
    }

    if (interaction.commandName === "help") {
      await handleHelp(interaction);
      return;
    }

    if (interaction.commandName === "join") {
      await handleJoin(interaction);
      return;
    }

    if (interaction.commandName === "transcribe") {
      await handleTranscribe(interaction);
      return;
    }

    if (interaction.commandName === "feedback") {
      await handleFeedback(interaction);
      return;
    }

    if (interaction.commandName === "links") {
      await handleLinks(interaction);
      return;
    }

    if (interaction.commandName === "stop") {
      await handleStop(interaction);
      return;
    }

    if (interaction.commandName === "leave") {
      await handleLeave(interaction);
      return;
    }
  } catch (error) {
    console.error("Interaction failed:", error);

    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(
          "❌ Something went wrong while handling this command."
        );
      } else {
        await interaction.reply({
          content: "❌ Something went wrong while handling this command.",
          ephemeral: true,
        });
      }
    } catch (replyError) {
      console.error("Failed to send interaction error reply:", replyError);
    }
  }
});

const healthApp = Fastify();

healthApp.get("/health", async () => {
  return {
    status: "ok",
    service: "pocketwave-discord-bot",
  };
});

await healthApp.listen({
  port: config.port,
  host: "0.0.0.0",
});

await client.login(token);