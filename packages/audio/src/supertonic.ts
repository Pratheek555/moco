// Voiceover from Supertonic 3, a neural voice that runs on the CPU through ONNX Runtime: no Python, no espeak-ng.
// The inference follows supertone-inc/supertonic nodejs/helper.js (MIT). The model is OpenRAIL-M: anything made with
// it must say it is machine-generated (Attachment A, item e), so a product using this has to label its videos.
// Separate entry point (@moco/audio/supertonic), so importing @moco/audio never loads the native runtime.
//
// Each line is spoken on its own and joined by joinLines(), the same as the system voices, so timings work the same.
// shortcut: lines are spoken whole; upstream splits at 300 characters. Add that if the script prompt ever allows longer lines.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as ort from "onnxruntime-node";
import type { TimedWord } from "@moco/spec";
import { amplitudeVisemes, parseWav, type Pcm } from "./lipsync.ts";
import { joinLines, wavFrom } from "./system.ts";
import type { Line } from "./index.ts";

export const SUPERTONIC_LANGUAGES = ["en", "ko", "ja", "ar", "bg", "cs", "da", "de", "el", "es", "et", "fi", "fr", "hi", "hr", "hu", "id", "it", "lt", "lv", "nl", "pl", "pt", "ro", "ru", "sk", "sl", "sv", "tr", "uk", "vi"];

export interface SupertonicOptions {
  modelDir: string; // holds onnx/ and voice_styles/
  voice?: string; // a preset: F1–F5, M1–M5
  speed?: number; // upstream's default is 1.05
  steps?: number; // denoising steps: more is cleaner and slower
}

interface Models {
  duration: ort.InferenceSession;
  textEncoder: ort.InferenceSession;
  vectorEstimator: ort.InferenceSession;
  vocoder: ort.InferenceSession;
  config: { ae: { sample_rate: number; base_chunk_size: number }; ttl: { chunk_compress_factor: number; latent_dim: number } };
  indexer: number[];
  style: { ttl: ort.Tensor; dp: ort.Tensor };
}

export function supertonicAudio(options: SupertonicOptions) {
  // Loaded on the first line and kept: the four sessions take a few seconds to open.
  let loaded: Promise<Models> | undefined;

  return {
    async tts(lines: Line[], _voice: { voiceId: string; backend: string }, language: string, outDir: string, signal?: AbortSignal) {
      const code = language.split("-")[0]!;
      if (!SUPERTONIC_LANGUAGES.includes(code)) throw new Error(`Supertonic has no ${language} voice.`);
      loaded ??= loadModels(options);
      const models = await loaded;

      const spoken: Pcm[] = [];
      for (const line of lines) {
        signal?.throwIfAborted();
        spoken.push(await speakLine(models, line.text, code, options));
      }
      const joined = joinLines(lines, spoken);
      await mkdir(outDir, { recursive: true });
      const file = join(outDir, "vo.wav");
      await writeFile(file, wavFrom(atPeak(joined.pcm)));
      return { file, durationSeconds: joined.pcm.samples.length / joined.pcm.sampleRate, words: joined.words };
    },
    // Supertonic gives no word timings to align against; tts() already timed every word.
    async align(): Promise<TimedWord[]> {
      throw new Error("supertonic gives its word timings from tts(); align() is never needed");
    },
    async visemes(file: string, words: TimedWord[]) {
      return amplitudeVisemes(parseWav(await readFile(file)), words);
    },
  };
}

async function loadModels(options: SupertonicOptions): Promise<Models> {
  const onnx = join(options.modelDir, "onnx");
  const [duration, textEncoder, vectorEstimator, vocoder] = await Promise.all(
    ["duration_predictor", "text_encoder", "vector_estimator", "vocoder"].map((name) => ort.InferenceSession.create(join(onnx, `${name}.onnx`))),
  );
  const config = JSON.parse(await readFile(join(onnx, "tts.json"), "utf8")) as Models["config"];
  const indexer = JSON.parse(await readFile(join(onnx, "unicode_indexer.json"), "utf8")) as number[];
  const preset = JSON.parse(await readFile(join(options.modelDir, "voice_styles", `${options.voice ?? "M1"}.json`), "utf8")) as Record<"style_ttl" | "style_dp", { data: unknown[]; dims: number[] }>;
  const tensor = (entry: { data: unknown[]; dims: number[] }) => new ort.Tensor("float32", Float32Array.from(entry.data.flat(Infinity) as number[]), entry.dims);
  return { duration: duration!, textEncoder: textEncoder!, vectorEstimator: vectorEstimator!, vocoder: vocoder!, config, indexer, style: { ttl: tensor(preset.style_ttl), dp: tensor(preset.style_dp) } };
}

// Punctuation the model doesn't know, in the plain form it does.
const PLAIN: [RegExp, string][] = [
  [/[–‑—]/g, "-"],
  [/[“”]/g, '"'],
  [/[‘’´`]/g, "'"],
  [/\s+/g, " "],
];

// The text as model ids, wrapped in its language tag. Characters outside the model's table are dropped.
export function textIds(text: string, language: string, indexer: number[]): number[] {
  const plain = PLAIN.reduce((out, [pattern, value]) => out.replace(pattern, value), text.normalize("NFKD")).trim();
  const ended = /[.!?;:,'")\]}…]$/.test(plain) ? plain : `${plain}.`;
  const tagged = `<${language}>${ended}</${language}>`;
  return Array.from(tagged).map((character) => indexer[character.charCodeAt(0)] ?? -1).filter((id) => id >= 0);
}

async function speakLine(models: Models, text: string, language: string, options: SupertonicOptions): Promise<Pcm> {
  const { config, style } = models;
  const ids = textIds(text, language, models.indexer);
  const textIdsTensor = new ort.Tensor("int64", BigInt64Array.from(ids.map(BigInt)), [1, ids.length]);
  const textMask = new ort.Tensor("float32", new Float32Array(ids.length).fill(1), [1, 1, ids.length]);

  const predicted = await models.duration.run({ text_ids: textIdsTensor, style_dp: style.dp, text_mask: textMask });
  const seconds = Number(predicted.duration!.data[0]) / (options.speed ?? 1.05);
  const encoded = await models.textEncoder.run({ text_ids: textIdsTensor, style_ttl: style.ttl, text_mask: textMask });

  // Start from noise and denoise it step by step into a latent, which the vocoder turns into sound.
  const sampleRate = config.ae.sample_rate;
  const chunk = config.ae.base_chunk_size * config.ttl.chunk_compress_factor;
  const latentLength = Math.floor((Math.floor(seconds * sampleRate) + chunk - 1) / chunk);
  const latentDim = config.ttl.latent_dim * config.ttl.chunk_compress_factor;
  const shape = [1, latentDim, latentLength];
  const latentMask = new ort.Tensor("float32", new Float32Array(latentLength).fill(1), [1, 1, latentLength]);
  const steps = options.steps ?? 8;
  const totalStep = new ort.Tensor("float32", Float32Array.of(steps), [1]);

  let latent: Float32Array = Float32Array.from({ length: latentDim * latentLength }, gaussian);
  for (let step = 0; step < steps; step += 1) {
    const denoised = await models.vectorEstimator.run({
      noisy_latent: new ort.Tensor("float32", latent, shape),
      text_emb: encoded.text_emb!,
      style_ttl: style.ttl,
      text_mask: textMask,
      latent_mask: latentMask,
      total_step: totalStep,
      current_step: new ort.Tensor("float32", Float32Array.of(step), [1]),
    });
    latent = denoised.denoised_latent!.data as Float32Array;
  }

  const vocoded = await models.vocoder.run({ latent: new ort.Tensor("float32", latent, shape) });
  const wave = vocoded.wav_tts!.data as Float32Array;
  return { sampleRate, samples: wave.slice(0, Math.floor(seconds * sampleRate)) };
}

// The whole reel scaled to one peak level: Supertonic's raw output is about 8 dB quieter than the system voices.
export function atPeak(pcm: Pcm, peak = 0.9): Pcm {
  const loudest = pcm.samples.reduce((max, sample) => Math.max(max, Math.abs(sample)), 0);
  return loudest === 0 ? pcm : { ...pcm, samples: pcm.samples.map((sample) => (sample * peak) / loudest) };
}

// One standard normal sample (Box-Muller).
function gaussian(): number {
  const u = Math.max(1e-10, Math.random());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
}
