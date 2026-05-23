import { useEffect, useRef, useState } from "react";
import "./App.css";

type TranscriptMessage = {
  type: "transcript";
  text: string;
  isFinal: boolean;
  speechFinal: boolean;
};

type TranslationMessage = {
  type: "translation";
  original: string;
  translated: string;
  sourceLanguage: string;
  targetLanguage: string;
};

type SettingsAppliedMessage = {
  type: "settings_applied";
  sourceLanguage: string;
  targetLanguage: string;
};

type SttReadyMessage = {
  type: "stt_ready";
  sourceLanguage: string;
  targetLanguage: string;
};

type ErrorMessage = {
  type: "error";
  message: string;
};

type ServerMessage =
  | TranscriptMessage
  | TranslationMessage
  | SettingsAppliedMessage
  | SttReadyMessage
  | ErrorMessage;

declare global {
  interface Window {
    pocketwave?: {
      onClickThroughChange: (callback: (value: boolean) => void) => void;
      onMinimalModeChange: (callback: (value: boolean) => void) => void;
    };
  }
}

const languages = [
  { code: "en", label: "English" },
  { code: "uk", label: "Ukrainian" },
  { code: "pl", label: "Polish" },
  { code: "de", label: "German" },
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
];

function getLanguageLabel(code: string) {
  return languages.find((language) => language.code === code)?.label ?? code;
}

function App() {
  const socketRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const clearTimerRef = useRef<number | null>(null);

  const [status, setStatus] = useState("Disconnected");
  const [original, setOriginal] = useState("");
  const [translated, setTranslated] = useState("");
  const [clickThrough, setClickThrough] = useState(false);
  const [minimalMode, setMinimalMode] = useState(false);

  const [sourceLanguage, setSourceLanguage] = useState("en");
  const [targetLanguage, setTargetLanguage] = useState("uk");

  useEffect(() => {
    window.pocketwave?.onClickThroughChange(setClickThrough);
    window.pocketwave?.onMinimalModeChange(setMinimalMode);
  }, []);

  function sendSettings() {
    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
      return;
    }

    socketRef.current.send(
      JSON.stringify({
        type: "settings",
        sourceLanguage,
        targetLanguage,
      })
    );
  }

  function connect() {
    const socket = new WebSocket("ws://localhost:4000/ws");

    socket.onopen = () => {
      setStatus("Connected");
      socketRef.current = socket;

      socket.send(
        JSON.stringify({
          type: "settings",
          sourceLanguage,
          targetLanguage,
        })
      );
    };

    socket.onclose = () => setStatus("Disconnected");
    socket.onerror = () => setStatus("Error");

    socket.onmessage = (event) => {
      const data = JSON.parse(event.data) as ServerMessage;

      if (data.type === "settings_applied") {
        console.log("Settings applied:", data);
      }

      if (data.type === "stt_ready") {
        console.log("STT ready:", data);
      }

      if (data.type === "error") {
        setTranslated(data.message);
      }

      if (data.type === "transcript") {
        setOriginal(data.text);
      }

      if (data.type === "translation") {
        setOriginal(data.original);
        setTranslated(data.translated);

        if (clearTimerRef.current) {
          window.clearTimeout(clearTimerRef.current);
        }

        clearTimerRef.current = window.setTimeout(() => {
          setOriginal("");
          setTranslated("");
        }, 5000);
      }
    };
  }

  async function startRecording() {
    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
      alert("Connect websocket first");
      return;
    }

    sendSettings();

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mediaRecorder = new MediaRecorder(stream);

    mediaRecorder.ondataavailable = async (event) => {
      if (
        event.data.size > 0 &&
        socketRef.current?.readyState === WebSocket.OPEN
      ) {
        const buffer = await event.data.arrayBuffer();
        socketRef.current.send(buffer);
      }
    };

    mediaRecorder.start(250);
    mediaRecorderRef.current = mediaRecorder;
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
  }

  return (
    <main className={minimalMode ? "app minimal" : "app"}>
      {!minimalMode && (
        <section className="controlPanel">
          <div className="dragHandle">
            <div className="brandRow">
              <span className="logo">PocketWave</span>
              <span className="status">{status}</span>
            </div>
          </div>

          <div className="languageRow">
            <label>
              From
              <select
                value={sourceLanguage}
                onChange={(event) => setSourceLanguage(event.target.value)}
              >
                {languages.map((language) => (
                  <option key={language.code} value={language.code}>
                    {language.label}
                  </option>
                ))}
              </select>
            </label>

            <label>
              To
              <select
                value={targetLanguage}
                onChange={(event) => setTargetLanguage(event.target.value)}
              >
                {languages.map((language) => (
                  <option key={language.code} value={language.code}>
                    {language.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="controls">
            <button onClick={connect}>Connect</button>
            <button onClick={startRecording}>Start</button>
            <button onClick={stopRecording}>Stop</button>
          </div>

          <div className="hotkeys">
            <span>Ctrl + Shift + H — Hide/Show</span>
            <span>
              Ctrl + Shift + T — Click-through:{" "}
              {clickThrough ? "ON" : "OFF"}
            </span>
            <span>Ctrl + Shift + M — Minimal mode</span>
          </div>
        </section>
      )}

      <section className={translated ? "subtitleHud active" : "subtitleHud idle"}>
        {original && <p className="hudOriginal">{original}</p>}

        {translated ? (
          <p className="hudTranslated">{translated}</p>
        ) : (
          <p className="hudWaiting">
            Listening: {getLanguageLabel(sourceLanguage)} →{" "}
            {getLanguageLabel(targetLanguage)}
          </p>
        )}
      </section>
    </main>
  );
}

export default App;