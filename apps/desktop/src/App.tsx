import { useEffect, useRef, useState } from "react";
import "./App.css";
import { config } from "./config";

type InputSource = "discord" | "microphone";

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
  mode?: "normal" | "tactical";
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

type OverlayTranslationMessage = {
  type: "overlay_translation";
  roomId: string;
  userId?: string;
  speakerName?: string;
  original: string;
  translated: string;
  mode?: "normal" | "tactical";
};

type RoomJoinedMessage = {
  type: "room_joined";
  roomId: string;
  role: string;
};

type TranslationHistoryItem = {
  id: string;
  speakerName: string;
  original: string;
  translated: string;
  mode: "normal" | "tactical";
  createdAt: number;
};

type ServerMessage =
  | TranscriptMessage
  | TranslationMessage
  | SettingsAppliedMessage
  | SttReadyMessage
  | ErrorMessage
  | OverlayTranslationMessage
  | RoomJoinedMessage;

declare global {
  interface Window {
    pocketwave?: {
      onClickThroughChange: (callback: (value: boolean) => void) => void;
      onMinimalModeChange: (callback: (value: boolean) => void) => void;
      onToggleListening: (callback: () => void) => void;
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

const STORAGE_KEYS = {
  roomId: "pocketwave.roomId",
  sourceLanguage: "pocketwave.sourceLanguage",
  targetLanguage: "pocketwave.targetLanguage",
  inputSource: "pocketwave.inputSource",
};

function getStoredValue(key: string, fallback: string) {
  return localStorage.getItem(key) ?? fallback;
}

function getLanguageLabel(code: string) {
  return languages.find((language) => language.code === code)?.label ?? code;
}

function downsampleBuffer(
  buffer: Float32Array,
  inputSampleRate: number,
  outputSampleRate: number
) {
  if (outputSampleRate === inputSampleRate) {
    return buffer;
  }

  const sampleRateRatio = inputSampleRate / outputSampleRate;
  const newLength = Math.round(buffer.length / sampleRateRatio);
  const result = new Float32Array(newLength);

  let offsetResult = 0;
  let offsetBuffer = 0;

  while (offsetResult < result.length) {
    const nextOffsetBuffer = Math.round((offsetResult + 1) * sampleRateRatio);

    let accum = 0;
    let count = 0;

    for (
      let i = offsetBuffer;
      i < nextOffsetBuffer && i < buffer.length;
      i += 1
    ) {
      accum += buffer[i];
      count += 1;
    }

    result[offsetResult] = accum / count;
    offsetResult += 1;
    offsetBuffer = nextOffsetBuffer;
  }

  return result;
}

function convertFloat32ToInt16(buffer: Float32Array) {
  const result = new Int16Array(buffer.length);

  for (let i = 0; i < buffer.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, buffer[i]));
    result[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }

  return result;
}

function App() {
  const socketRef = useRef<WebSocket | null>(null);
  const clearTimerRef = useRef<number | null>(null);

  const [status, setStatus] = useState("Disconnected");
  const [isConnected, setIsConnected] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [original, setOriginal] = useState("");
  const [translated, setTranslated] = useState("");
  const [clickThrough, setClickThrough] = useState(false);
  const [minimalMode, setMinimalMode] = useState(false);

  const [sourceLanguage, setSourceLanguage] = useState(() =>
  getStoredValue(STORAGE_KEYS.sourceLanguage, "en")
);

  const [targetLanguage, setTargetLanguage] = useState(() =>
  getStoredValue(STORAGE_KEYS.targetLanguage, "uk")
);

  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
const [selectedAudioDeviceId, setSelectedAudioDeviceId] = useState("");

const [roomId, setRoomId] = useState(() =>
  getStoredValue(STORAGE_KEYS.roomId, import.meta.env.VITE_ROOM_ID ?? "")
);

const [speakerName, setSpeakerName] = useState("");
const [pairingCode, setPairingCode] = useState("");
const [pairingStatus, setPairingStatus] = useState("");
const [pairedGuildName, setPairedGuildName] = useState("");

const pairingExpireTimerRef = useRef<number | null>(null);

const audioContextRef = useRef<AudioContext | null>(null);
const processorRef = useRef<ScriptProcessorNode | null>(null);
const streamRef = useRef<MediaStream | null>(null);

const isConnectedRef = useRef(false);
const isListeningRef = useRef(false);

const reconnectTimerRef = useRef<number | null>(null);
const shouldReconnectRef = useRef(true);

const [inputSource, setInputSource] = useState<InputSource>(() => {
  const stored = getStoredValue(STORAGE_KEYS.inputSource, "discord");

  return stored === "microphone" ? "microphone" : "discord";
});

const [roomStatus, setRoomStatus] = useState("Room not joined");
const [currentMode, setCurrentMode] = useState<"normal" | "tactical">("normal");

const [translationHistory, setTranslationHistory] = useState<
  TranslationHistoryItem[]
>([]);

  useEffect(() => {
    window.pocketwave?.onClickThroughChange(setClickThrough);
    window.pocketwave?.onMinimalModeChange(setMinimalMode);

    loadAudioDevices();
  }, []);

  useEffect(() => {
  window.pocketwave?.onToggleListening(() => {
    void toggleListening();
  });
}, []);

  useEffect(() => {
  isConnectedRef.current = isConnected;
}, [isConnected]);

useEffect(() => {
  isListeningRef.current = isListening;
}, [isListening]);

useEffect(() => {
  localStorage.setItem(STORAGE_KEYS.roomId, roomId);
}, [roomId]);

useEffect(() => {
  localStorage.setItem(STORAGE_KEYS.sourceLanguage, sourceLanguage);
}, [sourceLanguage]);

useEffect(() => {
  localStorage.setItem(STORAGE_KEYS.targetLanguage, targetLanguage);
}, [targetLanguage]);

useEffect(() => {
  localStorage.setItem(STORAGE_KEYS.inputSource, inputSource);
}, [inputSource]);

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

  useEffect(() => {
  if (!roomId) {
    return;
  }

  const timer = window.setTimeout(() => {
    connect();
  }, 400);

  return () => {
    window.clearTimeout(timer);

    shouldReconnectRef.current = false;

    if (reconnectTimerRef.current) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }

    socketRef.current?.close();
  };
}, []);

function scheduleReconnect() {
  if (!shouldReconnectRef.current) {
    return;
  }

  if (reconnectTimerRef.current) {
    return;
  }

  setStatus("Reconnecting...");

  reconnectTimerRef.current = window.setTimeout(() => {
    reconnectTimerRef.current = null;
    connect();
  }, 2000);
}

function handleSocketMessage(payload: any) {
  if (payload.type === "pairing_created") {
    setPairingCode(payload.code);
    setPairingStatus("Use this code in Discord with /pair");

    if (pairingExpireTimerRef.current) {
      window.clearTimeout(pairingExpireTimerRef.current);
    }

    pairingExpireTimerRef.current = window.setTimeout(() => {
      setPairingCode("");
      setPairingStatus("Pairing code expired. Generate a new one.");
    }, payload.expiresInMs ?? 10 * 60 * 1000);

    return;
  }

  if (payload.type === "pairing_expired") {
    setPairingCode("");
    setPairingStatus("Pairing code expired. Generate a new one.");
    return;
  }

  if (payload.type === "paired_room") {
    const nextRoomId = String(payload.roomId ?? "");
    const guildName = String(payload.guildName ?? "");

    setRoomId(nextRoomId);
    setPairedGuildName(guildName);
    setPairingCode("");
    setPairingStatus(`Paired with ${guildName || "Discord server"}`);

    localStorage.setItem("pocketwave.roomId", nextRoomId);

    if (pairingExpireTimerRef.current) {
      window.clearTimeout(pairingExpireTimerRef.current);
      pairingExpireTimerRef.current = null;
    }

    setRoomStatus("Room paired");

    return;
  }

  if (payload.type === "room_joined") {
    setRoomStatus("Room joined");
    return;
  }

  if (payload.type === "settings_applied") {
  console.log("Settings applied:", payload);
  return;
}

if (payload.type === "stt_ready") {
  console.log("STT ready:", payload);
  return;
}

if (payload.type === "transcript") {
  setOriginal(payload.text);
  return;
}

if (payload.type === "translation") {
  showLiveSubtitle({
    speakerName: inputSource === "microphone" ? "You" : "",
    original: payload.original,
    translated: payload.translated,
    mode: payload.mode ?? "normal",
  });
}

  if (payload.type === "overlay_translation") {
    showLiveSubtitle({
      speakerName: payload.speakerName ?? "Unknown",
      original: payload.original ?? "",
      translated: payload.translated ?? "",
      mode: payload.mode ?? "normal",
    });

    setStatus("Receiving Discord translation");
    return;
  }

  if (payload.type === "error") {
    setStatus(payload.message ?? "API error");
    return;
  }
}

function requestPairingCode() {
  setInputSource("discord");
  setPairingStatus("Creating pairing code...");
  setPairingCode("");

  const existingSocket = socketRef.current;

  if (existingSocket && existingSocket.readyState === WebSocket.OPEN) {
    existingSocket.send(
      JSON.stringify({
        type: "create_pairing",
      })
    );

    return;
  }

  const socket = new WebSocket(config.websocketUrl);
  socketRef.current = socket;
  setIsConnected(true);

  socket.onopen = () => {
    setStatus("Connected for pairing");

    socket.send(
      JSON.stringify({
        type: "create_pairing",
      })
    );
  };

  socket.onmessage = (event) => {
    const payload = JSON.parse(event.data);

    handleSocketMessage(payload);
  };

  socket.onerror = () => {
    setPairingStatus("Pairing connection error");
    setStatus("Connection error");
  };

  socket.onclose = () => {
    setStatus("Disconnected");
  };
}

function addToTranslationHistory(item: Omit<TranslationHistoryItem, "id" | "createdAt">) {
  const historyItem: TranslationHistoryItem = {
    ...item,
    id: `${Date.now()}-${Math.random()}`,
    createdAt: Date.now(),
  };

  setTranslationHistory((prev) => [historyItem, ...prev].slice(0, 3));
}

function showLiveSubtitle(payload: {
  speakerName?: string;
  original: string;
  translated: string;
  mode?: "normal" | "tactical";
}) {
  const nextSpeakerName = payload.speakerName ?? "";
  const nextOriginal = payload.original ?? "";
  const nextTranslated = payload.translated ?? "";
  const nextMode = payload.mode ?? "normal";

  setSpeakerName(nextSpeakerName);
  setOriginal(nextOriginal);
  setTranslated(nextTranslated);
  setCurrentMode(nextMode);

  addToTranslationHistory({
    speakerName: nextSpeakerName,
    original: nextOriginal,
    translated: nextTranslated,
    mode: nextMode,
  });

  if (clearTimerRef.current) {
    window.clearTimeout(clearTimerRef.current);
  }

  clearTimerRef.current = window.setTimeout(() => {
    setSpeakerName("");
    setOriginal("");
    setTranslated("");
    setCurrentMode("normal");
    setRoomStatus(roomId ? `Room joined: ${roomId}` : "Room not joined");
  }, 6000);
}


  function connect() {
    if (
    socketRef.current?.readyState === WebSocket.OPEN ||
    socketRef.current?.readyState === WebSocket.CONNECTING
  ) {
    return;
  }

  shouldReconnectRef.current = true;

    const socket = new WebSocket(config.websocketUrl);

    socket.onopen = () => {
      if (reconnectTimerRef.current) {
  window.clearTimeout(reconnectTimerRef.current);
  reconnectTimerRef.current = null;
}
  setStatus("Connected");
  setIsConnected(true);
  socketRef.current = socket;
  
  if (inputSource === "discord" && roomId) {
  setRoomStatus("Joining room...");

  socket.send(
    JSON.stringify({
      type: "join_room",
      roomId,
      role: "viewer",
    })
  );
}

if (inputSource === "microphone") {
  socket.send(
    JSON.stringify({
      type: "settings",
      sourceLanguage,
      targetLanguage,
    })
  );
}

}; // closes socket.onopen

socket.onclose = () => {
  setStatus("Disconnected");
  setIsConnected(false);
  setIsListening(false);
  setRoomStatus("Room disconnected");
  socketRef.current = null;

  scheduleReconnect();
};

socket.onerror = () => {
  setStatus("Connection Error");
  setIsConnected(false);
  setIsListening(false);
  setRoomStatus("Connection error");
};

    socket.onmessage = (event) => {
  const payload = JSON.parse(event.data);
  handleSocketMessage(payload);
};
  }

  async function startRecording() {
  if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
    alert("Connect websocket first");
    return;
  }

  if (inputSource !== "microphone") {
  return;
}

  if (isListening) {
    return;
  }

  try {
    sendSettings();

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: selectedAudioDeviceId
        ? {
            deviceId: {
              exact: selectedAudioDeviceId,
            },
            channelCount: 1,
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: true,
          }
        : {
            channelCount: 1,
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: true,
          },
    });

    streamRef.current = stream;

    const audioContext = new AudioContext();
    audioContextRef.current = audioContext;

    const source = audioContext.createMediaStreamSource(stream);

    const processor = audioContext.createScriptProcessor(4096, 1, 1);
    processorRef.current = processor;

    processor.onaudioprocess = (event) => {
      if (socketRef.current?.readyState !== WebSocket.OPEN) {
        return;
      }

      const input = event.inputBuffer.getChannelData(0);
      const downsampled = downsampleBuffer(
        input,
        audioContext.sampleRate,
        16000
      );

      const pcm16 = convertFloat32ToInt16(downsampled);

      if (pcm16.byteLength > 0) {
        socketRef.current.send(pcm16.buffer);
      }
    };

    source.connect(processor);
    processor.connect(audioContext.destination);

    setIsListening(true);
    setStatus("Listening");
  } catch (error) {
    console.error("Start recording error:", error);
    setStatus("Mic Error");
  }
}

  function stopRecording() {
  processorRef.current?.disconnect();
  processorRef.current = null;

  audioContextRef.current?.close();
  audioContextRef.current = null;

  streamRef.current?.getTracks().forEach((track) => {
    track.stop();
  });
  streamRef.current = null;

  setIsListening(false);
  setStatus(isConnected ? "Connected" : "Disconnected");
}

async function toggleListening() {
  if (inputSource !== "microphone") {
    return;
  }

  if (!isConnectedRef.current) {
    return;
  }

  if (isListeningRef.current) {
    stopRecording();
    return;
  }

  await startRecording();
}

async function loadAudioDevices() {
  try {
    await navigator.mediaDevices.getUserMedia({ audio: true });

    const devices = await navigator.mediaDevices.enumerateDevices();

    const microphones = devices.filter(
      (device) => device.kind === "audioinput"
    );

    setAudioDevices(microphones);

    if (!selectedAudioDeviceId && microphones[0]) {
      setSelectedAudioDeviceId(microphones[0].deviceId);
    }

    console.log("Audio input devices:", microphones);
  } catch (error) {
    console.error("Failed to load audio devices:", error);
    setStatus("Mic Error");
  }
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

          <div className="inputSourceRow">
  <button
    className={inputSource === "discord" ? "sourceButton active" : "sourceButton"}
    onClick={() => setInputSource("discord")}
  >
    Discord Voice
  </button>

  <button
    className={inputSource === "microphone" ? "sourceButton active" : "sourceButton"}
    onClick={() => setInputSource("microphone")}
  >
    Local Microphone
  </button>
</div>

{inputSource === "discord" && (
  <div className="roomStatus">
    {roomStatus}
  </div>
)}

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

{inputSource === "discord" && (
          <div className="roomRow">
  <label>
    Room ID
    <input
      value={roomId}
      onChange={(event) => setRoomId(event.target.value)}
      placeholder="Discord server ID"
    />
  </label>
</div>
)}

{inputSource === "discord" && (
  <div className="pairingBox">
    <div className="pairingTitle">Pair with Discord</div>

    <button
      type="button"
      className="pairingButton"
      onClick={requestPairingCode}
    >
      Generate Pairing Code
    </button>

    {pairingCode && (
      <div className="pairingCodeBox">
        <div className="pairingLabel">Use in Discord:</div>
        <div className="pairingCommand">/pair code: {pairingCode}</div>
      </div>
    )}

    {pairingStatus && (
      <div className="pairingStatus">{pairingStatus}</div>
    )}

    {pairedGuildName && (
      <div className="pairedGuild">
        Connected to: <strong>{pairedGuildName}</strong>
      </div>
    )}
  </div>
)}

{inputSource === "microphone" && (
  <div className="deviceRow">
    <label>
      Audio input
      <select
        value={selectedAudioDeviceId}
        onChange={(event) => setSelectedAudioDeviceId(event.target.value)}
    >
      {audioDevices.map((device) => (
        <option key={device.deviceId} value={device.deviceId}>
          {device.label || "Unknown microphone"}
        </option>
      ))}
    </select>
  </label>

  <button onClick={loadAudioDevices}>Refresh</button>
</div>
)}

          <div className="controls">
            <button onClick={connect} disabled={isConnected}>
  {isConnected ? "Connected" : "Connect"}
</button>

{inputSource === "microphone" && (
  <>
    <button onClick={startRecording} disabled={!isConnected || isListening}>
      {isListening ? "Listening..." : "Start"}
    </button>

    <button onClick={stopRecording} disabled={!isListening}>
      Stop
    </button>
  </>
)}
          </div>

          <div className="hotkeys">
            <span>Ctrl + Shift + H — Hide/Show</span>
            <span>
              Ctrl + Shift + T — Click-through:{" "}
              {clickThrough ? "ON" : "OFF"}
            </span>
            <span>Ctrl + Shift + M — Minimal mode</span>
            <span>Ctrl + Shift + R — Start/Stop listening</span>
          </div>
        </section>
      )}

<section className={translated ? "subtitleHud active" : "subtitleHud idle"}>
  {translated && (
    <div
      className={
        currentMode === "tactical"
          ? "modeBadge tactical"
          : "modeBadge"
      }
    >
      {currentMode}
    </div>
  )}

  {speakerName && <p className="hudSpeaker">{speakerName}</p>}

  {original && <p className="hudOriginal">{original}</p>}

  {translated ? (
    <p className="hudTranslated">{translated}</p>
  ) : (
    <p className="hudWaiting">
      {inputSource === "discord"
        ? `Discord room: ${roomId || "not set"}`
        : `Listening: ${getLanguageLabel(sourceLanguage)} → ${getLanguageLabel(
            targetLanguage
          )}`}
    </p>
  )}
</section>
{!minimalMode && translationHistory.length > 0 && (
  <section className="historyPanel">
    <div className="historyTitle">Recent translations</div>

    {translationHistory.map((item) => (
      <div key={item.id} className="historyItem">
        <div
          className={
            item.mode === "tactical"
              ? "historyMode tactical"
              : "historyMode"
          }
        >
          {item.mode}
        </div>

        {item.speakerName && (
          <div className="historySpeaker">{item.speakerName}</div>
        )}

        <div className="historyOriginal">{item.original}</div>
        <div className="historyTranslated">{item.translated}</div>
      </div>
    ))}
  </section>
)}
    </main>
  );
}

export default App;