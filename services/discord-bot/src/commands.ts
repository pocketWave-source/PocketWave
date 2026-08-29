import { ApplicationCommandOptionType } from "discord.js";

const LANGUAGE_CHOICES = [
  { name: "English", value: "en" },
  { name: "Ukrainian", value: "uk" },
  { name: "Polish", value: "pl" },
  { name: "Russian", value: "ru" },
  { name: "German", value: "de" },
  { name: "French", value: "fr" },
  { name: "Spanish", value: "es" },
];

export const commands = [
  {
    name: "ping",
    description: "Check if PocketWave bot is online",
  },
  {
    name: "help",
    description: "Show PocketWave commands and usage",
  },
  {
    name: "setup",
    description: "Show PocketWave setup instructions",
  },
  {
    name: "links",
    description: "Show useful PocketWave links",
  },
  {
    name: "room",
    description: "Show this server Room ID for the desktop overlay",
  },
  {
    name: "pair",
    description: "Pair PocketWave Desktop with this Discord server",
    options: [
      {
        name: "code",
        description: "Pairing code shown in PocketWave Desktop",
        type: ApplicationCommandOptionType.String,
        required: true,
      },
    ],
  },
  {
    name: "status",
    description: "Show the current PocketWave status",
  },
  {
    name: "join",
    description: "Make PocketWave bot join your current voice channel",
  },
  {
    name: "leave",
    description: "Make PocketWave bot leave the voice channel",
  },
  {
    name: "stop",
    description: "Stop transcription",
  },
  {
    name: "transcribe",
    description: "Start PocketWave voice translation",
    options: [
      {
        name: "from",
        description: "Source language",
        type: ApplicationCommandOptionType.String,
        required: false,
        choices: LANGUAGE_CHOICES,
      },
      {
        name: "to",
        description: "Target language",
        type: ApplicationCommandOptionType.String,
        required: false,
        choices: LANGUAGE_CHOICES,
      },
      {
        name: "mode",
        description: "Translation mode",
        type: ApplicationCommandOptionType.String,
        required: false,
        choices: [
          { name: "Normal", value: "normal" },
          { name: "Tactical", value: "tactical" },
        ],
      },
      {
          name: "voice",
          description: "Play translated speech back into the voice channel",
          type: ApplicationCommandOptionType.String,
          required: false,
          choices: [
            { name: "On", value: "on" },
            { name: "Off", value: "off" },
          ],
      },
    ],
  },
  {
    name: "feedback",
    description: "Send feedback about PocketWave",
    options: [
      {
        name: "category",
        description: "Feedback category",
        type: ApplicationCommandOptionType.String,
        required: true,
        choices: [
          { name: "Bug", value: "bug" },
          { name: "Setup", value: "setup" },
          { name: "Latency", value: "latency" },
          { name: "Translation", value: "translation" },
          { name: "Overlay", value: "overlay" },
          { name: "Idea", value: "idea" },
        ],
      },
      {
        name: "message",
        description: "What should be improved?",
        type: ApplicationCommandOptionType.String,
        required: true,
      },
    ],
  },
];