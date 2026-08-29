import {
  ChannelType,
  type ChatInputCommandInteraction,
} from "discord.js";
import { joinVoiceChannel } from "@discordjs/voice";

export async function handleJoin(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();

  if (!interaction.guildId || !interaction.guild) {
    await interaction.editReply("This command only works inside a server.");
    return;
  }

  const member = await interaction.guild.members.fetch(interaction.user.id);
  const voiceChannel = member.voice.channel;

  if (!voiceChannel || voiceChannel.type !== ChannelType.GuildVoice) {
    await interaction.editReply("Join a voice channel first.");
    return;
  }

  joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId: interaction.guildId,
    adapterCreator: interaction.guild.voiceAdapterCreator,
    selfDeaf: false,
    selfMute: true,
  });

  await interaction.editReply(
    `PocketWave joined **${voiceChannel.name}**. Translation is not active yet.`
  );

  console.log(`Joined voice channel: ${voiceChannel.name}`);
}