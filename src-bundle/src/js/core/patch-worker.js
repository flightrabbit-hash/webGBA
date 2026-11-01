import { buildGame, readPatch, WgbpError } from "./wgbp.js";
import { romChoices } from "./zip.js";

self.onmessage = async (event) => {
  const { patch, rom } = event.data ?? {};
  let last = 0;
  const progress = (stage, fraction) => {
    const now = performance.now();
    if (fraction > 0 && fraction < 1 && now - last < 40) return;
    last = now;
    self.postMessage({ type: "progress", stage, fraction });
  };
  try {
    const made = await buildGame(readPatch(new Uint8Array(patch)), romChoices(new Uint8Array(rom)), { onProgress: progress });
    self.postMessage({ type: "done", wgba: made.wgba, sha1: made.sha1, base: made.base, entry: made.entry, same: made.same }, [made.wgba.buffer]);
  } catch (error) {
    self.postMessage({ type: "error", wgbp: error instanceof WgbpError, code: error?.code ?? "", params: error?.params ?? {}, message: String(error?.message ?? error) });
  }
};
