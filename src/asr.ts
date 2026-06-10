// Local dictation: NVIDIA Parakeet TDT 0.6B v3 running in the tab via
// parakeet.js (onnxruntime-web). Loaded from CDN only when the user opts in;
// the model downloads once (~620 MB int8) and runs entirely on-device — audio
// never leaves the computer.
//
// No live streaming: record the take, then ONE transcription when the user
// clicks stop. (Tried and rejected with real use: continuous re-decoding lags
// hopelessly on the wasm backend, pause-gated decoding still felt laggy, and
// the library's chunked StatefulStreamingTranscriber degenerates to "." after
// the first chunk on this model — disjoint chunks lose conformer context.)
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
// AudioWorklet (ScriptProcessorNode is deprecated). The processor is a tiny
// pass-through that ships each input frame to the main thread; we register it
// from an inline blob URL so it survives the single-file bundle (no separate
// asset to load). It writes nothing to its output, so the destination connection
// that keeps it pumping stays silent — no mic feedback.
const WORKLET_SRC = `
class CaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) this.port.postMessage(ch.slice(0));
    return true;
  }
}
registerProcessor('capture', CaptureProcessor);
`;
let workletUrl: string | null = null;

let ctx: AudioContext | null = null;
let stream: MediaStream | null = null;
let node: AudioWorkletNode | null = null;
let chunks: Float32Array[] = [];
let recording = false;

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

/** Start recording the mic. Nothing is decoded until stopDictation(). */
export async function startDictation() {
  stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
  });
  ctx = new AudioContext({ sampleRate: 16000 });
  if (!workletUrl)
    workletUrl = URL.createObjectURL(new Blob([WORKLET_SRC], { type: "application/javascript" }));
  await ctx.audioWorklet.addModule(workletUrl);
  const src = ctx.createMediaStreamSource(stream);
  node = new AudioWorkletNode(ctx, "capture", { channelCount: 1 });
  chunks = [];
  recording = true;
  node.port.onmessage = (e) => {
    if (recording) chunks.push(e.data as Float32Array);
  };
  src.connect(node);
  node.connect(ctx.destination);
}

/** Stop the mic and return one clean transcription of the whole take. */
export async function stopDictation(): Promise<string> {
  recording = false;
  node?.disconnect();
  stream?.getTracks().forEach((t) => t.stop());
  await ctx?.close().catch(() => {});
  ctx = null;
  node = null;
  stream = null;
  const pcm = merged();
  chunks = [];
  if (pcm.length < 4000) return "";
  try {
    const r = await model.transcribe(pcm, 16000, {});
    return (r?.utterance_text ?? "").trim();
  } catch (e) {
    console.warn("[asr] final transcribe failed:", e);
    return "";
  }
}
