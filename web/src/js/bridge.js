import * as store from "./store.js";

export const context = { game: "" };

const quota = (error) => error?.name === "QuotaExceededError" || /quota/i.test(String(error?.message ?? ""));

export const core = {
  log(level, text) {
    const line = `[webGBA] ${text}`;
    if (level === "ERROR") console.error(line);
    else if (level === "WARN") console.warn(line);
    else console.info(line);
    return Promise.resolve();
  },
  async saveWrite(id, bytes) {
    try {
      await store.putSave(id, bytes, context.game);
    } catch (error) {
      const wrapped = new Error(quota(error) ? context.quotaText || "quota" : String(error?.message ?? error));
      wrapped.quota = quota(error);
      context.onSaveFailed?.(wrapped);
      throw wrapped;
    }
    context.onSaved?.(id);
    return { action: "written", path: `${id}.sav` };
  },
  async storeRead() {
    return new Uint8Array(0);
  },
  async storeWrite() {
    throw new Error("state");
  },
};
