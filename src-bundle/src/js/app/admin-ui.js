import { OFF_CODES, PIN_KEYS, PIN_LENGTH, readRecord, recordOf } from "../core/admin.js";
import { pickText } from "../core/lang-text.js";
import { updatePicker } from "./update-pick.js";
import { centerTexts, sizeText } from "./zip-pick.js";
import { t } from "../shell/i18n.js";

const KNOWN = new Set(["wrong", "limit", "locked", "nokey", "key", "off", "store", "r2", "network", "again", "size"]);
export const PAD_TEXTS = ".apad__label, .apad__state";

const make = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
};

export function adminErrorText(error) {
  const code = error?.code;
  if (code === "http") return t("admin.err.http", { status: error.extra?.status ?? "" });
  if (KNOWN.has(code)) return t(`admin.err.${code}`);
  return String(error?.message ?? error);
}

/** 6칸 표시 + 0~9·!·# 열두 키 + 지우기. 누른 글자는 화면에 표시하지 않는다(칸만 채움). */
export function pinPad({ icon = () => null, onChange = () => {}, onEnter = () => {} } = {}) {
  let value = "";
  let busy = false;
  const root = make("div", "apad");
  const top = make("div", "apad__top");
  const slots = make("div", "apad__slots");
  slots.setAttribute("role", "img");
  const cells = Array.from({ length: PIN_LENGTH }, () => {
    const cell = make("span", "apad__slot");
    cell.append(make("span", "apad__dot"));
    slots.append(cell);
    return cell;
  });
  const erase = make("button", "btn apad__key apad__key--erase");
  erase.type = "button";
  erase.dataset.key = "erase";
  erase.title = t("admin.pad.erase");
  erase.setAttribute("aria-label", t("admin.pad.erase"));
  const glyph = icon("backspace");
  if (glyph) erase.append(glyph);
  else erase.append(make("span", "apad__label", "←"));
  top.append(slots, erase);
  const keys = make("div", "apad__keys");
  keys.setAttribute("role", "group");
  keys.setAttribute("aria-label", t("admin.pad.keys"));
  const buttons = PIN_KEYS.map((key) => {
    const button = make("button", "btn apad__key");
    button.type = "button";
    button.dataset.key = key;
    button.append(make("span", "apad__label", key));
    button.addEventListener("click", () => add(key));
    keys.append(button);
    return button;
  });
  const state = make("p", "apad__state", t("admin.pad.checking"));
  state.setAttribute("aria-live", "polite");
  state.hidden = true;
  root.append(top, keys, state);

  const paint = () => {
    cells.forEach((cell, i) => cell.classList.toggle("is-on", i < value.length));
    slots.setAttribute("aria-label", t("admin.pad.count", { n: value.length }));
    erase.disabled = busy || !value.length;
    for (const button of buttons) button.disabled = busy || value.length >= PIN_LENGTH;
    root.classList.toggle("is-busy", busy);
    state.hidden = !busy;
    onChange(value.length);
  };
  const add = (key) => {
    if (busy || value.length >= PIN_LENGTH) return;
    value += key;
    paint();
  };
  const back = () => {
    if (busy || !value) return;
    value = value.slice(0, -1);
    paint();
  };
  erase.addEventListener("click", back);
  const onKey = (event) => {
    if (!root.isConnected || event.isComposing || event.ctrlKey || event.altKey || event.metaKey) return;
    if (PIN_KEYS.includes(event.key)) add(event.key);
    else if (event.key === "Backspace") back();
    else if (event.key === "Enter") onEnter();
    else return;
    event.preventDefault();
    event.stopPropagation();
  };
  document.addEventListener("keydown", onKey, true);
  paint();
  return {
    node: root,
    get value() {
      return value;
    },
    clear() {
      value = "";
      paint();
    },
    setBusy(on) {
      busy = Boolean(on);
      paint();
      if (busy) centerTexts([state]);
    },
    center: () => centerTexts(root.querySelectorAll(PAD_TEXTS)),
    detach: () => document.removeEventListener("keydown", onKey, true),
  };
}

/**
 * 관리자 모드 흐름(웹·exe 공용). d = 껍데기가 주는 것:
 *  client · load() · save(rec|null) · dialog({title, body, kind, actions}) → { done, buttons } · closeDialog(value)
 *  labels { ok, cancel, close, get } · listText · icon(name)
 *  notify(text, level) · changed() · registeredIds() → Set · download(game, url, onFraction) · refresh() · lang() · log(level, text)
 */
export function createAdminFlow(d) {
  const record = () => readRecord(d.load());

  function askPin(text) {
    return new Promise((resolve) => {
      let busy = false;
      let okButton = null;
      let cancelButton = null;
      const paint = () => {
        if (okButton) okButton.disabled = busy || pad.value.length !== PIN_LENGTH;
        if (cancelButton) cancelButton.disabled = busy;
      };
      const submit = async () => {
        if (busy || pad.value.length !== PIN_LENGTH) return;
        busy = true;
        pad.setBusy(true);
        paint();
        center();
        let result;
        try {
          result = { ok: recordOf(await d.client.verify(pad.value)) };
        } catch (error) {
          result = { error };
        }
        pad.clear();
        d.closeDialog(result);
      };
      const pad = pinPad({ icon: d.icon, onChange: paint, onEnter: submit });
      const center = () => (d.centerDialog ? d.centerDialog() : pad.center());
      const view = d.dialog({ title: t("admin.pad.title"), body: [text, pad.node], kind: "pin", actions: [{ label: d.labels.cancel, value: null }, { label: d.labels.ok, primary: true, run: submit }] });
      [cancelButton, okButton] = view.buttons;
      paint();
      center();
      view.done.then((value) => {
        pad.detach();
        resolve(value && (value.ok || value.error) ? value : null);
      });
    });
  }

  async function enter() {
    const out = await askPin(t("admin.pad.text"));
    if (!out) return false;
    if (out.error) {
      d.notify(adminErrorText(out.error), "warn");
      d.log?.("WARN", `관리자 모드 입력 실패 ${out.error.code ?? ""}`);
      return false;
    }
    d.save(out.ok);
    d.changed();
    d.notify(t("admin.on"));
    d.log?.("INFO", "관리자 모드 활성화");
    return true;
  }

  function leave() {
    d.save(null);
    d.changed();
    d.notify(t("admin.off"));
    d.log?.("INFO", "관리자 모드 해제");
  }

  function turnOff(error) {
    d.save(null);
    d.changed();
    d.notify(error.code === "wrong" ? t("admin.err.wrongOff") : adminErrorText(error), "warn");
    d.log?.("WARN", `관리자 모드 다시 입력 실패 → 해제 ${error.code}`);
  }

  async function fetchList() {
    let rec = record();
    if (!rec) {
      d.save(null);
      d.changed();
      return null;
    }
    try {
      return { rec, listing: await d.client.list(rec.token) };
    } catch (error) {
      if (error.code !== "again") {
        d.notify(adminErrorText(error), "warn");
        return null;
      }
    }
    const out = await askPin(t("admin.pad.again"));
    if (!out) return null;
    if (out.error) {
      if (OFF_CODES.has(out.error.code)) turnOff(out.error);
      else d.notify(adminErrorText(out.error), "warn");
      return null;
    }
    rec = out.ok;
    d.save(rec);
    d.changed();
    try {
      return { rec, listing: await d.client.list(rec.token) };
    } catch (error) {
      d.notify(adminErrorText(error), "warn");
      return null;
    }
  }

  function art(item) {
    if (!item.game.label) return null;
    const img = make("img", "upick__img");
    img.alt = "";
    img.draggable = false;
    img.src = item.game.label;
    return img;
  }

  const metaOf = (item) => {
    if (item.state === "busy") return t("admin.row.download", { percent: Math.max(0, Math.min(100, Math.floor((item.fraction ?? 0) * 100))) });
    if (item.state === "done") return t("admin.row.done");
    if (item.state === "failed") return t("update.row.failed", { reason: item.reason || "?" });
    return t("admin.row.ready", { version: item.to || "?", size: sizeText(item.size) });
  };

  async function importRoms() {
    d.notify(t("admin.list.loading"));
    const got = await fetchList();
    if (!got) return null;
    const session = got.rec;
    const ids = await d.registeredIds();
    const games = (got.listing.items ?? []).filter((game) => game && typeof game.id === "string" && typeof game.key === "string" && !ids.has(game.id));
    if (!games.length) {
      d.notify(t("admin.empty"));
      return null;
    }
    const items = games.map((game) => ({
      key: game.key,
      game,
      name: pickText(game.names, d.lang()) || pickText(game.short, d.lang()) || String(game.file ?? game.id).replace(/\.wgba$/i, ""),
      kind: "patch",
      state: "ready",
      to: game.version,
      size: game.size,
    }));
    const get = async (item, progress) => {
      let url;
      try {
        ({ urls: [{ url }] } = await d.client.urls(session.token, [item.key]));
      } catch (error) {
        throw new Error(adminErrorText(error));
      }
      try {
        await d.download(item.game, url, (fraction) => progress({ stage: "download", fraction }));
      } catch (error) {
        d.log?.("WARN", `롬 가져오기 실패 ${item.game.id} ${item.game.version}: ${error?.code ?? ""} ${error?.message ?? error}`);
        throw new Error(adminErrorText(error));
      }
      d.log?.("INFO", `롬 가져오기 ${item.game.id} ${item.game.version} (${item.size}바이트)`);
      return true;
    };
    let close = null;
    let go = null;
    const picker = updatePicker({
      items,
      art,
      button: null,
      startOn: false,
      apply: get,
      install: get,
      stop: async () => true,
      metaOf,
      listLabel: t("admin.list.label"),
      onChange: ({ chosen, busy }) => {
        if (!go) return;
        go.disabled = busy || chosen === 0;
        const label = d.labels.get;
        const node = go.querySelector(".btn__label") ?? go;
        if (node.textContent !== label) node.textContent = label;
        close.disabled = busy;
        d.centerDialog?.();
      },
    });
    const view = d.dialog({
      title: t("admin.list.title", { count: items.length }),
      body: [d.listText, picker.node],
      kind: "pick",
      actions: [
        { label: d.labels.close, value: false },
        { label: d.labels.get, primary: true, run: () => picker.runChosen() },
      ],
    });
    [close, go] = view.buttons;
    picker.refresh();
    picker.center();
    window.addEventListener("resize", picker.center);
    view.done.then(() => {
      window.removeEventListener("resize", picker.center);
      d.refresh();
    });
    return picker;
  }

  return { isOn: () => Boolean(record()), record, enter, leave, importRoms };
}
