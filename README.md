## Current MVP

PocketWave currently supports:

* Discord voice channel listening
* Speech-to-text through Deepgram
* AI translation through OpenAI
* Discord text channel translation output
* Electron desktop overlay
* WebSocket rooms for Discord → overlay relay
* Language selection in `/transcribe`
* Normal and Tactical translation modes
* Discord message cooldown
* Protection against duplicate transcription listeners
* Speaker name display in overlay
* Recent translation history in overlay
* Render cloud deployment for API and Discord bot
* Windows desktop installer through GitHub Releases

## Production MVP v0.1.1

PocketWave v0.1.1 is the first cloud-ready MVP.

It includes:

```txt
Render API
+
Render Discord Bot
+
Windows Desktop Overlay
+
Discord Voice Translation
+
GitHub Release Installer
```

Current production flow:

```txt
Discord Voice Channel
        ↓
PocketWave Discord Bot on Render
        ↓
PocketWave API on Render
        ↓
Deepgram Speech-to-Text
        ↓
OpenAI Translation
        ↓
Discord Text Channel
        ↓
Windows Desktop Overlay
```

## Deployment

PocketWave currently uses Render for cloud deployment.

### Render Services

The project uses two Render services:

```txt
pocketwave-api
pocketwave-discord-bot
```

### API Service

Render service type:

```txt
Web Service
Runtime: Docker
Root Directory: services/api
Dockerfile Path: services/api/Dockerfile
```

Required environment variables:

```env
PORT=4000
DEEPGRAM_API_KEY=
OPENAI_API_KEY=
```

Health check:

```txt
https://your-api-service.onrender.com/health
```

Expected response:

```json
{
  "status": "ok"
}
```

WebSocket URL:

```txt
wss://your-api-service.onrender.com/ws
```

### Discord Bot Service

Render service type:

```txt
Web Service
Runtime: Docker
Root Directory: services/discord-bot
Dockerfile Path: services/discord-bot/Dockerfile
```

Required environment variables:

```env
PORT=4001
DISCORD_TOKEN=
DISCORD_CLIENT_ID=
DISCORD_GUILD_ID=
POCKETWAVE_API_WS_URL=wss://your-api-service.onrender.com/ws
```

The Discord bot includes a small health server so Render can detect an open port.

Health check:

```txt
https://your-discord-bot-service.onrender.com/health
```

Expected response:

```json
{
  "status": "ok",
  "service": "pocketwave-discord-bot"
}
```

## Desktop App

The desktop overlay is built with Electron, React, Vite, and TypeScript.

For development:

```bash
cd apps/desktop
npm run dev
```

For production build:

```bash
cd apps/desktop
npm run pack
```

For Windows installer:

```bash
cd apps/desktop
npm run dist
```

The generated files are located in:

```txt
apps/desktop/release/
```

Main installer file:

```txt
PocketWave-0.1.1-x64.exe
```

The installer should be uploaded to GitHub Releases, not committed to the repository.

## Desktop Environment Variables

For development, create:

```txt
apps/desktop/.env
```

Example:

```env
VITE_WS_URL=wss://your-api-service.onrender.com/ws
VITE_ROOM_ID=your_discord_guild_id
```

For production build, create:

```txt
apps/desktop/.env.production
```

Example:

```env
VITE_WS_URL=wss://your-api-service.onrender.com/ws
VITE_ROOM_ID=
```

`VITE_ROOM_ID` can be left empty for public builds. Users can enter their Room ID manually in the overlay.

## GitHub Release

PocketWave desktop builds are distributed through GitHub Releases.

Recommended release format:

```txt
Tag: v0.1.1
Title: PocketWave v0.1.1
Asset: PocketWave-0.1.1-x64.exe
```

Release notes example:

```txt
PocketWave v0.1.1

First cloud MVP build.

Features:
- Discord voice translation
- Discord text channel output
- Electron desktop overlay
- Normal and Tactical translation modes
- Speaker name display
- Recent translation history
- Render backend support
- Windows installer
```

## MVP Test Flow

1. Make sure Render API is live.
2. Make sure Render Discord bot is live.
3. Install and run the PocketWave desktop app.
4. Open Discord.
5. Join a voice channel.
6. Run:

```txt
/join
```

7. Start translation:

```txt
/transcribe from: English to: Ukrainian mode: Tactical
```

8. Speak in the Discord voice channel.
9. Translation should appear:

   * in Discord text channel
   * in PocketWave desktop overlay

## Desktop Overlay Modes

PocketWave Desktop has two input modes:

### Discord Voice

Uses the Discord bot and cloud API.

```txt
Discord Voice
→ Discord Bot
→ Render API
→ Desktop Overlay
```

This is the recommended mode for gaming.

### Local Microphone

Uses the local microphone directly.

```txt
Local Microphone
→ Render API
→ Desktop Overlay
```

This is useful for testing microphone transcription without Discord.

## Desktop Overlay Hotkeys

```txt
Ctrl + Shift + H — Hide / Show overlay
Ctrl + Shift + T — Toggle click-through mode
Ctrl + Shift + M — Toggle minimal mode
Ctrl + Shift + R — Start / Stop local microphone listening
```

## Windows SmartScreen Warning

The current Windows installer is not code-signed.

Because of this, Windows SmartScreen may show a warning when launching the installer.

This is expected for early MVP builds.

Future production releases should use code signing.

## Updated Current Limitations

* Render free services may sleep after inactivity.
* First request after sleep may be slow.
* Desktop app requires manual Room ID setup.
* Windows installer is not code-signed.
* No auto-update system yet.
* No user accounts yet.
* No billing/subscriptions yet.
* No production authentication layer yet.
* Tactical mode quality still needs real gameplay testing.

## Updated Roadmap

### v0.2

* Improve onboarding for Room ID setup
* Add better desktop settings screen
* Add auto-update support
* Improve Tactical mode prompts
* Add latency optimization
* Add production logging
* Add basic usage tracking

### v0.3

* User accounts
* Subscription limits
* Usage dashboard
* Team/clan rooms
* Better installer and code signing
* Streamer/OBS mode

### v1.0

* Public beta
* Payments
* Production infrastructure
* Multi-server support
* Stable desktop release channel
