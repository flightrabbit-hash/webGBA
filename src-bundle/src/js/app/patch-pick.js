import { updateErrorText, updatePicker } from "./update-pick.js";
import { sizeText } from "./zip-pick.js";
import { pickText } from "../core/lang-text.js";
import { UpdateError } from "../core/wgba-update.js";
import { t } from "../shell/i18n.js";

const DONE_MS = 600;
const percent = (fraction) => Math.max(0, Math.min(100, Math.floor((fraction ?? 0) * 100)));

export function patchRowMeta(item) {
  if (item.exists) return t("patch.row.exists", { version: item.exists.version || "?" });
  if (item.state === "busy") {
    if (item.stage === "download") return t("update.row.download", { percent: percent(item.fraction) });
    if (item.stage === "rom") return t("update.row.rom", { percent: percent(item.fraction) });
    return t("patch.row.update", { from: item.from, to: item.to, percent: percent(item.fraction) });
  }
  if (item.state === "done") return item.result?.updateError ? t("patch.row.doneOld", { version: item.result.version, file: item.result.file }) : t("patch.row.done", { version: item.result?.version ?? item.to, file: item.result?.file ?? "" });
  if (item.state === "failed") return t("update.row.failed", { reason: item.reason || "?" });
  return t("patch.row.ready", { version: item.to, size: sizeText(item.size) });
}

const patchRowLabel = (item) => {
  if (item.state === "busy") return "";
  if (item.exists || item.state === "done") return t("patch.btn.play");
  if (item.state === "failed") return t("update.btn.retry");
  return "";
};

const setLabel = (node, text) => {
  const target = node.querySelector(".btn__label") ?? node;
  if (target.textContent !== text) target.textContent = text;
};

function againBox(onChange) {
  const node = document.createElement("div");
  node.className = "zpick__all upick__again";
  node.setAttribute("role", "checkbox");
  node.setAttribute("aria-checked", "false");
  node.tabIndex = 0;
  const box = document.createElement("span");
  box.className = "cbox";
  box.setAttribute("aria-hidden", "true");
  box.append(Object.assign(document.createElement("span"), { className: "cbox__mark" }), Object.assign(document.createElement("span"), { className: "cbox__dash" }));
  const label = Object.assign(document.createElement("span"), { className: "zpick__allLabel", textContent: t("patch.pick.again") });
  node.append(box, label);
  let on = false;
  const flip = () => {
    on = !on;
    node.setAttribute("aria-checked", String(on));
    onChange(on);
  };
  node.addEventListener("click", flip);
  node.addEventListener("keydown", (event) => {
    if (event.isComposing || (event.key !== " " && event.key !== "Spacebar" && event.key !== "Enter")) return;
    event.preventDefault();
    event.stopPropagation();
    if (!event.repeat) flip();
  });
  return node;
}

export function createPatchPicker(d) {
  function ask({ offers, romName, parentName }) {
    const items = offers.map((offer) => ({
      key: offer.id,
      offer,
      name: pickText(offer.name, d.lang()) || offer.id,
      from: offer.target.version,
      to: offer.version,
      kind: offer.exists ? "none" : "patch",
      exists: offer.exists ?? null,
      size: offer.size,
      state: "ready",
      stage: "",
      fraction: 0,
      reason: "",
      running: false,
      result: null,
    }));
    let left = null;
    let go = null;
    let abort = null;
    let pending = null;
    let stopping = false;
    let closing = false;
    let ran = false;
    let again = false;
    const close = (value) => {
      if (closing) return;
      closing = true;
      d.closeDialog(value);
    };
    const doneItems = () => items.filter((item) => item.state === "done");
    const install = async (item, progress) => {
      if (stopping) throw new Error(updateErrorText(new UpdateError("cancelled")));
      const controller = new AbortController();
      abort = controller;
      try {
        pending = d.install(item.offer, progress, controller.signal);
        item.result = await pending;
        return true;
      } catch (error) {
        d.log(error?.code === "cancelled" ? "INFO" : "WARN", `패치 설치 ${error?.code === "cancelled" ? "취소" : "실패"} ${item.key} ${item.from}: ${error?.code ?? ""} ${error?.message ?? error}`);
        throw new Error(updateErrorText(error));
      } finally {
        if (abort === controller) abort = null;
        pending = null;
      }
    };
    const picker = updatePicker({
      items,
      button: d.rowButton,
      kinds: d.kinds,
      apply: install,
      install,
      stop: async () => true,
      metaOf: patchRowMeta,
      labelOf: patchRowLabel,
      listLabel: t("patch.pick.listLabel"),
      openRow: (item) => close({ action: "play", item }),
      onChange: ({ chosen, total, busy }) => {
        if (!go || closing) return;
        if (busy) {
          ran = true;
          setLabel(left, d.labels.cancel);
          left.disabled = stopping;
          go.disabled = true;
          return;
        }
        stopping = false;
        const done = doneItems();
        const failed = items.some((item) => item.state === "failed");
        if (ran && done.length && !failed) {
          left.disabled = true;
          go.disabled = true;
          setTimeout(() => close({ action: "play", item: done[0] }), DONE_MS);
          return;
        }
        left.disabled = false;
        setLabel(left, done.length ? d.labels.close : d.labels.skip);
        setLabel(go, done.length ? d.labels.play : d.labels.install(chosen, total));
        go.disabled = !done.length && chosen === 0;
      },
    });
    if (items.length === 1) picker.node.classList.add("upick--single");
    const onLeft = () => {
      if (picker.busy) {
        stopping = true;
        left.disabled = true;
        abort?.abort();
        return;
      }
      close({ action: doneItems().length ? "close" : "skip" });
    };
    const onGo = () => {
      const done = doneItems();
      if (done.length) close({ action: "play", item: done[0] });
      else picker.runChosen();
    };
    const answer = d.openDialog({
      title: t("patch.pick.title", { count: items.length }),
      body: [t(d.textKey, { rom: romName, parent: parentName }), d.hintKey ? t(d.hintKey) : null, picker.node, againBox((on) => (again = on))].filter(Boolean),
      kind: "pick",
      actions: [
        { label: d.labels.skip, id: "patch-skip", run: onLeft },
        { label: d.labels.install(0, 0), id: "patch-go", go: true, primary: true, run: onGo },
      ],
    });
    [left, go] = d.actions();
    picker.refresh();
    window.addEventListener("resize", picker.center);
    return answer.then(async (value) => {
      window.removeEventListener("resize", picker.center);
      closing = true;
      if (picker.busy) {
        stopping = true;
        abort?.abort();
        await pending?.catch(() => {});
        await null;
      }
      const chosen = value && typeof value === "object" ? value : { action: doneItems().length ? "close" : "skip" };
      return { ...chosen, again, made: doneItems() };
    });
  }

  return { ask };
}
