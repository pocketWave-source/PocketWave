export const DISCORD_SAMPLE_RATE = 48000;
export const TARGET_SAMPLE_RATE = 16000;
export const DISCORD_CHANNELS = 2;

function stereo48kToMonoFloat32(chunk: Buffer) {
  const sampleCount = chunk.length / 2 / DISCORD_CHANNELS;
  const mono = new Float32Array(sampleCount);

  for (let i = 0; i < sampleCount; i += 1) {
    const left = chunk.readInt16LE(i * 4);
    const right = chunk.readInt16LE(i * 4 + 2);

    const mixed = (left + right) / 2;
    mono[i] = mixed / 32768;
  }

  return mono;
}

function downsampleFloat32(
  input: Float32Array,
  inputRate: number,
  outputRate: number
) {
  if (inputRate === outputRate) {
    return input;
  }

  const ratio = inputRate / outputRate;
  const outputLength = Math.floor(input.length / ratio);
  const output = new Float32Array(outputLength);

  for (let i = 0; i < outputLength; i += 1) {
    const start = Math.floor(i * ratio);
    const end = Math.floor((i + 1) * ratio);

    let sum = 0;
    let count = 0;

    for (let j = start; j < end && j < input.length; j += 1) {
      sum += input[j];
      count += 1;
    }

    output[i] = count > 0 ? sum / count : 0;
  }

  return output;
}

function float32ToInt16Buffer(input: Float32Array) {
  const output = Buffer.alloc(input.length * 2);

  for (let i = 0; i < input.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, input[i]));
    const int16 = sample < 0 ? sample * 0x8000 : sample * 0x7fff;

    output.writeInt16LE(int16, i * 2);
  }

  return output;
}

export function convertDiscordPcmToDeepgramPcm(chunk: Buffer) {
  const mono48k = stereo48kToMonoFloat32(chunk);

  const mono16k = downsampleFloat32(
    mono48k,
    DISCORD_SAMPLE_RATE,
    TARGET_SAMPLE_RATE
  );

  return float32ToInt16Buffer(mono16k);
}