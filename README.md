# PocketWave

Realtime AI voice translation overlay for gamers.

PocketWave translates Discord voice chat in real time and shows subtitles both in Discord text channels and in a desktop overlay.

## Current MVP

PocketWave currently supports:

* Discord voice channel listening
* Speech-to-text through Deepgram
* AI translation through OpenAI
* Discord text channel translation output
* Electron desktop overlay
* WebSocket rooms for Discord → overlay relay
* Language selection in `/transcribe`
* Discord message cooldown
* Protection against duplicate transcription listeners
* Dockerized backend services

## Architecture

```txt
Discord Voice Channel
        ↓
PocketWave Discord Bot
        ↓
Opus → PCM16 16k mono
        ↓
PocketWave API WebSocket
        ↓
Deepgram Speech-to-Text
        ↓
OpenAI Translation
        ↓
Discord Text Channel
        ↓
Electron Overlay
```

## Tech Stack

### Backend

* Node.js
* TypeScript
* Fastify
* WebSocket
* Docker Compose

### AI

* Deepgram Realtime Speech-to-Text
* OpenAI Translation

### Discord

* discord.js
* @discordjs/voice
* prism-media
* opusscript

### Desktop

* Electron
* React
* Vite
* TypeScript

## Project Structure

```txt
PocketWave/
  apps/
    desktop/
      electron/
      src/

  services/
    api/
      src/

    discord-bot/
      src/

  docker-compose.yml
  .env.example
  README.md
```

## Environment Variables

Create a `.env` file in the project root.

```env
PORT=4000

DEEPGRAM_API_KEY=
OPENAI_API_KEY=

DISCORD_TOKEN=
DISCORD_CLIENT_ID=
DISCORD_GUILD_ID=

POCKETWAVE_API_WS_URL=ws://api:4000/ws
```

For the desktop app, create:

```txt
apps/desktop/.env
```

```env
VITE_ROOM_ID=your_discord_guild_id
```

## Discord Setup

1. Create an application in Discord Developer Portal.
2. Create a bot user.
3. Copy the bot token.
4. Copy the Application ID.
5. Enable Developer Mode in Discord.
6. Copy your test server ID.
7. Invite the bot with these scopes:

```txt
bot
applications.commands
```

Required bot permissions:

```txt
View Channels
Send Messages
Connect
Speak
Use Voice Activity
```

## Run Backend Services

From the project root:

```bash
docker compose up --build
```

Expected logs:

```txt
api-1           | Server listening at http://0.0.0.0:4000
discord-bot-1   | Slash commands registered
discord-bot-1   | PocketWave Discord bot logged in as ...
```

## Run Desktop Overlay

In another terminal:

```bash
cd apps/desktop
npm run dev
```

## Discord Commands

### Check bot status

```txt
/ping
```

### Join voice channel

Join a Discord voice channel first, then run:

```txt
/join
```

### Start translation

```txt
/transcribe from: English to: Ukrainian
```

Other examples:

```txt
/transcribe from: Polish to: Ukrainian
/transcribe from: Ukrainian to: English
/transcribe from: German to: Ukrainian
```

### Stop translation

```txt
/stop
```

### Leave voice channel

```txt
/leave
```

## Desktop Overlay Hotkeys

```txt
Ctrl + Shift + H — Hide / Show overlay
Ctrl + Shift + T — Toggle click-through mode
Ctrl + Shift + M — Toggle minimal mode
Ctrl + Shift + R — Start / Stop local microphone listening
```

## Recommended Game Setup

For games with anti-cheat, use:

```txt
Borderless Windowed mode
+
PocketWave Electron overlay
+
No game injection
+
No memory reading
+
No DLL hooks
```

PocketWave runs as a separate desktop window. It does not modify the game process.

## MVP Test Flow

1. Start Docker services.
2. Start Electron desktop overlay.
3. Open Discord.
4. Join a voice channel.
5. Run `/join`.
6. Run `/transcribe from: English to: Ukrainian`.
7. Speak in the voice channel.
8. Translation should appear:

   * in Discord text channel
   * in PocketWave overlay

## Current Limitations

* Discord text channel output has cooldown.
* Overlay needs manual Room ID setup.
* Translation latency depends on speech speed and AI response time.
* Fast tactical subtitle mode is not implemented yet.
* Production authentication is not implemented yet.
* Billing/subscriptions are not implemented yet.
* Desktop installer is not implemented yet.

## Troubleshooting

### Slash commands do not appear in Discord

Check that the bot was invited with both scopes:

```txt
bot
applications.commands
```

If you added `applications.commands` later, remove the bot from the server and invite it again with the updated OAuth2 URL.

Also check that `DISCORD_CLIENT_ID` is the Application ID and `DISCORD_GUILD_ID` is the Discord server ID.

---

### DiscordAPIError[50001]: Missing Access

This usually means one of these is wrong:

```txt
DISCORD_GUILD_ID is incorrect
Bot is not invited to that server
Bot was invited without applications.commands scope
Bot does not have enough permissions
```

Fix:

```txt
1. Enable Developer Mode in Discord
2. Right-click your server
3. Copy Server ID
4. Put it into DISCORD_GUILD_ID
5. Reinvite the bot with bot + applications.commands scopes
```

Discord’s `50001` code means missing access, and slash commands require the `applications.commands` scope.

---

### Bot joins voice but does not detect speaking

Check Docker logs:

```bash
docker compose logs -f discord-bot
```

Expected logs:

```txt
User started speaking: ...
Discord audio converted for ... chunks ...
```

If you do not see `User started speaking`, check:

```txt
Bot has Connect permission
Bot has Use Voice Activity permission
You are speaking in the same voice channel
The bot is not deafened
```

---

### Error: Cannot find module '@discordjs/opus', 'node-opus', or 'opusscript'

`prism-media` needs an Opus decoder package.

Install `opusscript`:

```bash
cd services/discord-bot
npm install opusscript
```

Then rebuild Docker:

```bash
docker compose down -v
docker compose build --no-cache discord-bot
docker compose up
```

Check inside the container:

```bash
docker compose exec discord-bot npm ls opusscript
```

---

### Deepgram returns duration: 0 and channels: 0

This usually means the audio format is wrong.

PocketWave expects raw PCM audio:

```txt
encoding=linear16
sample_rate=16000
channels=1
```

For Discord audio, the bot must convert:

```txt
Discord Opus
→ PCM 48k stereo
→ PCM16 16k mono
→ API WebSocket
```

Do not send Discord Opus packets directly to Deepgram.

Deepgram requires `sample_rate` when using raw audio with `encoding`.

---

### Desktop overlay does not receive Discord translations

Check that the desktop Room ID matches the Discord server ID:

```env
VITE_ROOM_ID=your_discord_guild_id
```

Then restart the desktop app:

```bash
cd apps/desktop
npm run dev
```

Also check API logs:

```bash
docker compose logs -f api
```

Expected logs:

```txt
Client joined room ... as viewer
```

---

### Discord text channel receives translations, but overlay does not

That means the Discord bot and API are working, but the overlay is not connected to the same room.

Check:

```txt
apps/desktop/.env has VITE_ROOM_ID
VITE_ROOM_ID equals DISCORD_GUILD_ID
Desktop app was restarted after changing .env
Desktop app pressed Connect
```

---

### Overlay appears above the game but blocks mouse clicks

Press:

```txt
Ctrl + Shift + T
```

This toggles click-through mode.

The overlay should then pass mouse clicks through to the game.

---

### Overlay does not appear above the game

Try:

```txt
Use Borderless Windowed mode instead of Exclusive Fullscreen
Restart the desktop overlay
Press Ctrl + Shift + H
Check if the overlay is hidden
```

For anti-cheat protected games, avoid injection, memory reading, hooks, or anything that modifies the game process.

PocketWave should run as a separate transparent desktop window.

---

### Docker keeps using old dependencies

If Docker does not see a newly installed package, remove volumes and rebuild:

```bash
docker compose down -v
docker compose build --no-cache
docker compose up
```

This is important because `/app/node_modules` can be stored in a Docker volume.

---

### Environment variables are not applied

Check that `.env` exists in the project root:

```txt
PocketWave/.env
```

Then restart Docker:

```bash
docker compose down
docker compose up --build
```

Docker Compose passes variables into containers through `env_file`, which is used in this project.

---

### Local desktop microphone works, but Discord mode does not

These are different pipelines:

```txt
Desktop microphone → API → Overlay
Discord voice → Bot → API → Discord text + Overlay
```

If desktop microphone works but Discord does not, debug `discord-bot`.

If Discord text works but overlay does not, debug WebSocket rooms / `VITE_ROOM_ID`.

---

### Translation is delayed during fast speech

This is expected in the current MVP.

The current flow waits for finalized speech segments before translation:

```txt
speech
→ Deepgram final transcript
→ OpenAI translation
→ subtitle output
```

For faster gameplay, future versions should add:

```txt
Fast mode
Tactical summary mode
Short callout translation
OpenAI streaming
```

Example tactical output:

```txt
Original:
They are coming from the left side of our ship

Tactical:
Enemy left. Boarding.
```

## Roadmap

### Short Term

* Add anti-spam batching for Discord messages
* Add tactical translation mode
* Auto-connect desktop overlay to Discord guild room
* Improve overlay UI
* Add settings persistence
* Add proper logging levels

### Mid Term

* Add user accounts
* Add subscription limits
* Add usage tracking
* Add streamer mode
* Add OBS/browser source output
* Add desktop installer

### Long Term

* Multi-server support
* Team/clan plans
* Voice-to-voice translation
* Gaming slang optimization
* Native low-latency audio pipeline
* Production billing

## Security Notes

Never commit `.env`.

Never expose:

```txt
DISCORD_TOKEN
DEEPGRAM_API_KEY
OPENAI_API_KEY
```

If any token is leaked, rotate it immediately.

## Product Direction

PocketWave is not a generic translator.

The goal is:

```txt
Realtime tactical voice translation for gamers.
```

The core user value:

```txt
I do not understand my teammate’s language
↓
PocketWave shows the meaning instantly
↓
I can react in the game
```

The long-term focus is not perfect literary translation.

The focus is:

```txt
low latency
short subtitles
gaming callouts
team communication
```
