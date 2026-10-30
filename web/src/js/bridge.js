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
  // 상태 저장(퀵슬롯). player.saveState 가 host.stateSave() 바로 뒤에 부른다 — 화면 사진은 await 전에 떠서 그 순간 화면이 된다.
  async storeRead(id, slot) {
    return (await store.stateBytes(id, slot)) ?? new Uint8Array(0);
  },
  async storeWrite(id, slot, bytes) {
    const extra = context.stateExtra?.(slot) ?? {};
    let thumb = null;
    try {
      thumb = (await extra.thumb) ?? null;
    } catch {}
    try {
      await store.putState(id, slot, bytes, { game: context.game, auto: Boolean(extra.auto), thumb });
    } catch (error) {
      const wrapped = new Error(quota(error) ? context.quotaText || "quota" : String(error?.message ?? error));
      wrapped.quota = quota(error);
      throw wrapped;
    }
    return { action: "written", path: `${id}.ss${slot}` };
  },
};
