# PocketWave

Realtime AI voice translation overlay for gamers.

PocketWave translates Discord voice chat in real time and shows subtitles both in Discord text channels and in a desktop overlay.

## Current MVP

PocketWave currently supports:

- Discord voice channel listening
- Speech-to-text through Deepgram
- AI translation through OpenAI
- Discord text channel translation output
- Electron desktop overlay
- WebSocket rooms for Discord → overlay relay
- Language selection in `/transcribe`
- Dockerized backend services

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

- Node.js
- TypeScript
- Fastify
- WebSocket
- Docker Compose

### AI

- Deepgram Realtime STT
- OpenAI Translation

### Discord

- discord.js
- @discordjs/voice
- prism-media
- opusscript

### Desktop

- Electron
- React
- Vite
- TypeScript

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
   - in Discord text channel
   - in PocketWave overlay

## Current Limitations

- Discord text channel output has cooldown.
- Overlay needs manual Room ID setup.
- Translation latency depends on speech speed and AI response time.
- Fast tactical subtitle mode is not implemented yet.
- Production authentication is not implemented yet.
- Billing/subscriptions are not implemented yet.

## Roadmap

### Short Term

- Add anti-spam batching for Discord messages
- Add tactical translation mode
- Auto-connect desktop overlay to Discord guild room
- Improve overlay UI
- Add settings persistence

### Mid Term

- Add user accounts
- Add subscription limits
- Add usage tracking
- Add streamer mode
- Add OBS/browser source output

### Long Term

- Native desktop installer
- Multi-server support
- Team/clan plans
- Voice-to-voice translation
- Gaming slang optimization

## Security Notes

Never commit `.env`.

Never expose:

```txt
DISCORD_TOKEN
DEEPGRAM_API_KEY
OPENAI_API_KEY
```

If any token is leaked, rotate it immediately.