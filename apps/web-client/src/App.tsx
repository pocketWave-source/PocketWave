import { useRef, useState } from "react";
import "./App.css";
import { config } from "./config";

type TranslationMessage = {
  type: "translation";
  original: string;
  translated: string;
};

function App() {
  const socketRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);

  const [status, setStatus] = useState("Disconnected");
  const [original, setOriginal] = useState("");
  const [translated, setTranslated] = useState("");

  function connect() {
    const socket = new WebSocket(config.websocketUrl)

    socket.onopen = () => setStatus("Connected");
    socket.onclose = () => setStatus("Disconnected");
    socket.onerror = () => setStatus("Error");

    socket.onmessage = (event) => {
      const data = JSON.parse(event.data) as TranslationMessage;

      if (data.type === "translation") {
        setOriginal(data.original);
        setTranslated(data.translated);
      }
    };

    socketRef.current = socket;
  }

  async function startRecording() {
    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
      alert("Connect websocket first");
      return;
    }

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mediaRecorder = new MediaRecorder(stream);

    mediaRecorder.ondataavailable = async (event) => {
      if (event.data.size > 0 && socketRef.current?.readyState === WebSocket.OPEN) {
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
    <main className="app">
      <section className="panel">
        <div className="brand">
          <span className="logo">PocketWave</span>
          <span className="status">{status}</span>
        </div>

        <div className="controls">
          <button onClick={connect}>Connect</button>
          <button onClick={startRecording}>Start</button>
          <button onClick={stopRecording}>Stop</button>
        </div>
      </section>

      <section className="subtitleBox">
        <div className="label">ORIGINAL</div>
        <p className="original">{original || "Waiting for voice..."}</p>

        <div className="label">UKRAINIAN</div>
        <p className="translated">{translated || "Очікування перекладу..."}</p>
      </section>
    </main>
  );
}

export default App;