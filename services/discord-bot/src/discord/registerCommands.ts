import { REST, Routes } from "discord.js";
import { commands } from "../commands";
import { config } from "../config";

const rest = new REST({ version: "10" }).setToken(config.discordToken!);

export async function registerGuildCommands(guildId: string) {
  try {
    await rest.put(
      Routes.applicationGuildCommands(config.discordClientId!, guildId),
      { body: commands }
    );

    console.log(`Registered slash commands for guild ${guildId}`);
  } catch (error) {
    console.error(`Failed to register slash commands for guild ${guildId}:`, error);
  }
}