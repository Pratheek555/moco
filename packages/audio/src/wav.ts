export const SAMPLE_RATE = 44100;

export interface Stereo {
  L: Float32Array;
  R: Float32Array;
}

export const stereo = (seconds: number): Stereo => {
  const n = Math.max(1, Math.ceil(seconds * SAMPLE_RATE));
  return { L: new Float32Array(n), R: new Float32Array(n) };
};

/** Peak-normalise, soft-clip and encode 16-bit PCM WAV. */
export function encodeWav(buf: Stereo, peak = 0.89): Buffer {
  const n = buf.L.length;
  let max = 1e-6;
  for (let i = 0; i < n; i++) max = Math.max(max, Math.abs(buf.L[i]!), Math.abs(buf.R[i]!));
  const gain = peak / max;
  const out = Buffer.alloc(44 + n * 4);
  out.write('RIFF', 0);
  out.writeUInt32LE(36 + n * 4, 4);
  out.write('WAVE', 8);
  out.write('fmt ', 12);
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(2, 22);
  out.writeUInt32LE(SAMPLE_RATE, 24);
  out.writeUInt32LE(SAMPLE_RATE * 4, 28);
  out.writeUInt16LE(4, 32);
  out.writeUInt16LE(16, 34);
  out.write('data', 36);
  out.writeUInt32LE(n * 4, 40);
  const soft = (x: number) => Math.tanh(x * 1.1) / Math.tanh(1.1);
  for (let i = 0; i < n; i++) {
    out.writeInt16LE(Math.round(soft(buf.L[i]! * gain) * 32767), 44 + i * 4);
    out.writeInt16LE(Math.round(soft(buf.R[i]! * gain) * 32767), 46 + i * 4);
  }
  return out;
}

/** Duration in seconds of a PCM WAV buffer (walks chunks; tolerant of extra headers). */
export function wavDuration(data: Buffer): number {
  if (data.toString('ascii', 0, 4) !== 'RIFF') return 0;
  let offset = 12;
  let byteRate = 0;
  while (offset + 8 <= data.length) {
    const id = data.toString('ascii', offset, offset + 4);
    const size = data.readUInt32LE(offset + 4);
    if (id === 'fmt ') byteRate = data.readUInt32LE(offset + 16);
    if (id === 'data') {
      const real = Math.min(size, data.length - offset - 8);
      return byteRate ? real / byteRate : 0;
    }
    offset += 8 + size + (size % 2);
  }
  return 0;
}

const MPEG_RATES: Record<number, number[]> = {
  // MPEG1 Layer III, MPEG2/2.5 Layer III (kbps)
  1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const SAMPLE_RATES: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

/** Duration in seconds of an MP3 buffer by walking its frames. */
export function mp3Duration(data: Buffer): number {
  let i = 0;
  if (data.toString('ascii', 0, 3) === 'ID3') {
    const size = ((data[6]! & 0x7f) << 21) | ((data[7]! & 0x7f) << 14) | ((data[8]! & 0x7f) << 7) | (data[9]! & 0x7f);
    i = 10 + size;
  }
  let seconds = 0;
  while (i + 4 <= data.length) {
    if (data[i] !== 0xff || (data[i + 1]! & 0xe0) !== 0xe0) {
      i++;
      continue;
    }
    const version = (data[i + 1]! >> 3) & 0x3;
    const layer = (data[i + 1]! >> 1) & 0x3;
    const bitrateIdx = (data[i + 2]! >> 4) & 0xf;
    const srIdx = (data[i + 2]! >> 2) & 0x3;
    const padding = (data[i + 2]! >> 1) & 0x1;
    if (version === 1 || layer !== 1 || bitrateIdx === 0 || bitrateIdx === 15 || srIdx === 3) {
      i++;
      continue;
    }
    const kbps = MPEG_RATES[version === 3 ? 1 : 2]![bitrateIdx]!;
    const sr = SAMPLE_RATES[version]![srIdx]!;
    const samples = version === 3 ? 1152 : 576;
    const frameLen = Math.floor(((samples / 8) * kbps * 1000) / sr) + padding;
    if (frameLen <= 0) {
      i++;
      continue;
    }
    seconds += samples / sr;
    i += frameLen;
  }
  return seconds;
}

export function audioDuration(data: Buffer, ext: string) {
  return ext.toLowerCase() === '.wav' ? wavDuration(data) : mp3Duration(data);
}
