import { applyDelta, UpdateError } from "./wgba-update.js";

self.onmessage = async (event) => {
  const { source, delta } = event.data ?? {};
  let last = 0;
  const progress = (stage, fraction) => {
    const now = performance.now();
    if (fraction > 0 && fraction < 1 && now - last < 40) return;
    last = now;
    self.postMessage({ type: "progress", stage, fraction });
  };
  try {
    const out = await applyDelta(new Uint8Array(source), new Uint8Array(delta), { onProgress: progress });
    self.postMessage({ type: "done", bytes: out.buffer }, [out.buffer]);
  } catch (error) {
    self.postMessage({ type: "error", update: error instanceof UpdateError, code: error?.code ?? "", params: error?.params ?? {}, message: String(error?.message ?? error) });
  }
};
