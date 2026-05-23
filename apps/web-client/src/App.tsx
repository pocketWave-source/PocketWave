import { useRef, useState } from "react";

function App() {
  const socketRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);

  const [status, setStatus] = useState("Disconnected");
  const [logs, setLogs] = useState<string[]>([]);

  function addLog(text: string) {
    setLogs((prev) => [text, ...prev]);
  }

  async function connect() {
    const socket = new WebSocket("ws://localhost:4000/ws");

    socket.onopen = () => {
      setStatus("Connected");
      addLog("WebSocket connected");
    };

    socket.onmessage = (event) => {
  const parsed = JSON.parse(event.data);

  if (parsed.type === "translation") {
    addLog(`${parsed.original} → ${parsed.translated}`);
  }
};

    socket.onclose = () => {
      setStatus("Disconnected");
      addLog("WebSocket disconnected");
    };

    socketRef.current = socket;
  }

  async function startRecording() {
    if (!socketRef.current) {
      alert("Connect websocket first");
      return;
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
    });

    const mediaRecorder = new MediaRecorder(stream);

    mediaRecorder.ondataavailable = async (event) => {
      if (
        event.data.size > 0 &&
        socketRef.current?.readyState === WebSocket.OPEN
      ) {
        const arrayBuffer = await event.data.arrayBuffer();

        socketRef.current.send(arrayBuffer);

        addLog(`Sent audio chunk: ${arrayBuffer.byteLength} bytes`);
      }
    };

    mediaRecorder.start(250);

    mediaRecorderRef.current = mediaRecorder;

    addLog("Recording started");
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop();
    addLog("Recording stopped");
  }

  return (
    <main style={{ padding: 24 }}>
      <h1>PocketWave Audio Streaming</h1>

      <p>Status: {status}</p>

      <button onClick={connect}>Connect</button>

      <hr />

      <button onClick={startRecording}>Start Recording</button>

      <button onClick={stopRecording}>Stop Recording</button>

      <hr />

      <h2>Logs</h2>

      {logs.map((log, index) => (
        <pre key={index}>{log}</pre>
      ))}
    </main>
  );
}

export default App;