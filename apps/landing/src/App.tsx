import "./App.css";

const downloadUrl = import.meta.env.VITE_DOWNLOAD_URL || "#";
const telegramUrl = import.meta.env.VITE_TELEGRAM_URL || "#";
const discordInviteUrl = import.meta.env.VITE_DISCORD_INVITE_URL || "#";

function App() {
  return (
    <main className="page">
      <section className="hero">
        <nav className="nav">
          <div className="brand">
            <div className="logo">PW</div>
            <span>PocketWave</span>
          </div>

          <div className="navLinks">
            <a href="#features">Features</a>
            <a href="#how">How it works</a>
            <a href="#beta">Beta</a>
          </div>
        </nav>

        <div className="heroGrid">
          <div className="heroContent">
            <div className="badge">AI subtitle overlay for gamers</div>

            <h1>Understand your teammates. Even when they speak another language.</h1>

            <p className="subtitle">
              PocketWave translates Discord voice chat in real time and shows short subtitles
              while you play.
            </p>

            <div className="actions">
  <a className="primaryBtn" href={downloadUrl} target="_blank" rel="noreferrer">
    Download for Windows
  </a>

  <a className="secondaryBtn" href={discordInviteUrl} target="_blank" rel="noreferrer">
    Invite Discord Bot
  </a>

  <a className="secondaryBtn" href={telegramUrl} target="_blank" rel="noreferrer">
    Join Telegram
  </a>
</div>

            <p className="note">
              Early MVP build. Currently optimized for Discord voice channels and Windows overlay.
            </p>
          </div>

          <div className="mockup">
            <div className="mockupTop">
              <span></span>
              <span></span>
              <span></span>
            </div>

            <div className="gameArea">
              <div className="voiceCard">
                <div className="voiceHeader">Discord Voice</div>
                <div className="voiceLine">
                  <span className="dot"></span>
                  Alex: They are boarding left side!
                </div>
              </div>

              <div className="subtitleBox">
                <div className="mode">TACTICAL</div>
                <div className="speaker">Alex</div>
                <div className="original">They are boarding left side!</div>
                <div className="translated">Вони заходять зліва!</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="features" className="section">
        <h2>Built for real multiplayer games</h2>

        <div className="cards">
          <div className="card">
            <h3>Discord voice translation</h3>
            <p>Translate voice chat from Discord into short readable messages.</p>
          </div>

          <div className="card">
            <h3>Desktop overlay</h3>
            <p>See subtitles on top of your game without switching windows.</p>
          </div>

          <div className="card">
            <h3>Tactical mode</h3>
            <p>Turn long speech into short callouts like “enemy left” or “need heal”.</p>
          </div>
        </div>
      </section>

      <section id="how" className="section split">
        <div>
          <h2>How it works</h2>
          <p>
            PocketWave connects your Discord voice channel to an AI translation backend,
            then sends the translated text to your desktop overlay.
          </p>
        </div>

        <div className="steps">
          <div>1. Download PocketWave Desktop</div>
<div>2. Invite the Discord bot</div>
<div>3. Run /setup in your Discord server</div>
<div>4. Join voice chat and start /transcribe</div>
        </div>
      </section>

      <section id="beta" className="section beta">
        <h2>Join the early beta</h2>
        <p>
          PocketWave is currently in MVP testing. Join the Telegram channel to follow progress,
          get updates, and help shape the product.
        </p>

        <div className="actions center">
          <a className="primaryBtn" href={telegramUrl} target="_blank" rel="noreferrer">
            Join Telegram
          </a>

          <a className="secondaryBtn" href={discordInviteUrl} target="_blank" rel="noreferrer">
    Invite Discord Bot
  </a>

          <a className="secondaryBtn" href={downloadUrl} target="_blank" rel="noreferrer">
            Download MVP
          </a>
        </div>
      </section>
    </main>
  );
}

export default App;