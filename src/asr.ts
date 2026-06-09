// Local dictation: NVIDIA Parakeet TDT 0.6B v3 running in the tab via
// parakeet.js (onnxruntime-web). Loaded from CDN only when the user opts in;
// the model downloads once (~620 MB int8) and runs entirely on-device — audio
// never leaves the computer.
//
// "Streaming" = re-transcribe the whole take on a self-pacing loop and rewrite
// the textbox, so words firm up with full acoustic context. (Verified live:
// the library's chunked StatefulStreamingTranscriber degenerates to "." after
// the first chunk on this model — disjoint 2s chunks lose conformer context —
// so whole-take decoding it is. Lag grows with take length; dictated chat
// messages are short, and the final pass on stop is always complete.)
//
// Why wasm+int8 rather than webgpu: the fp16 encoder (1.2 GB) fails session
// creation in ort-web with std::bad_alloc (wasm heap ceiling), verified live.
// int8 on wasm decodes ~realtime single-threaded.
import { note, error, progressNote } from "./ui";

const PARAKEET_URL = "https://esm.run/parakeet.js@1.4.4";
const MODEL_KEY = "parakeet-tdt-0.6b-v3";

let parakeet: any = null;
let model: any = null;
let loading = false;

export const asrSupported = () => !!navigator.mediaDevices?.getUserMedia;
export const asrReady = () => !!model;

export async function loadAsr(): Promise<boolean> {
  if (model) return true;
  if (loading) return false;
  loading = true;
  const update = progressNote();
  try {
    update("Getting the speech engine…");
    parakeet = await import(/* @vite-ignore */ PARAKEET_URL);
    update("Downloading the speech model (about 620 MB, one time)…");
    model = await parakeet.fromHub(MODEL_KEY, {
      backend: "wasm",
      encoderQuant: "int8",
      decoderQuant: "int8",
      progress: (p: any) => {
        if (p && typeof p.progress === "number")
          update(`Downloading the speech model… ${Math.round(p.progress)}%`);
      },
    });
    note("Voice is ready ✓ — click the mic and just talk.");
    (window as any).__tabagent_asr = model; // console debugging aid
    return true;
  } catch (e) {
    model = null;
    error("I couldn't load the speech model: " + (e as Error).message);
    return false;
  } finally {
    loading = false;
  }
}

// ---- recording ----
let ctx: AudioContext | null = null;
let stream: MediaStream | null = null;
let proc: ScriptProcessorNode | null = null;
let chunks: Float32Array[] = [];
let recording = false;
let timer: ReturnType<typeof setInterval> | null = null;
let busy = false;
let lastLen = 0;

function merged(): Float32Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Float32Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

export const dictating = () => recording;

/** Start the mic; calls onText with the best-so-far transcript as you speak. */
export async function startDictation(onText: (text: string) => void) {
  stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
  });
  ctx = new AudioContext({ sampleRate: 16000 });
  const src = ctx.createMediaStreamSource(stream);
  proc = ctx.createScriptProcessor(4096, 1, 1);
  chunks = [];
  lastLen = 0;
  recording = true;
  proc.onaudioprocess = (e) => {
    if (recording) chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
  };
  src.connect(proc);
  proc.connect(ctx.destination);

  // Self-pacing: the busy flag means a slow decode just delays the next pass.
  timer = setInterval(async () => {
    if (!recording || busy) return;
    const pcm = merged();
    if (pcm.length < 12000 || pcm.length === lastLen) return; // <0.75s or no new audio
    lastLen = pcm.length;
    busy = true;
    try {
      const r = await model.transcribe(pcm, 16000, {});
      if (recording && r?.utterance_text) onText(r.utterance_text.trim());
    } catch (e) {
      console.warn("[asr] partial transcribe failed:", e);
    } finally {
      busy = false;
    }
  }, 1000);
}

/** Stop the mic and return a final clean transcription of the whole take. */
export async function stopDictation(): Promise<string> {
  recording = false;
  if (timer) clearInterval(timer);
  timer = null;
  proc?.disconnect();
  stream?.getTracks().forEach((t) => t.stop());
  await ctx?.close().catch(() => {});
  ctx = null;
  proc = null;
  stream = null;
  while (busy) await new Promise((r) => setTimeout(r, 100));
  const pcm = merged();
  chunks = [];
  lastLen = 0;
  if (pcm.length < 4000) return "";
  try {
    const r = await model.transcribe(pcm, 16000, {});
    return (r?.utterance_text ?? "").trim();
  } catch (e) {
    console.warn("[asr] final transcribe failed:", e);
    return "";
  }
}
