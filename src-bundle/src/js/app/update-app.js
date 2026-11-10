import { APP_EXE, appSource, fetchAppFile, loadApp, planApp } from "../core/app-update.js";
import { compareVersions } from "../core/wgba-format.js";
import { indexMemory, readOverrides, sha256Hex } from "../core/wgba-update.js";
import { updateErrorText } from "./update-pick.js";
import { sizeText } from "./zip-pick.js";

const GAUGE_DOWNLOAD = 0.9;

export function createAppUpdater(d) {
  const { t } = d;
  let checked = false;
  let found = null;
  let shown = false;
  const overrides = () => (d.testMode() ? readOverrides() : null);
  const current = () => overrides()?.app?.version || d.info().version;
  const load = () => loadApp(appSource(overrides()), { cache: d.cache, memory: indexMemory() });

  function prepare() {
    if (checked || navigator.onLine === false) return;
    load();
  }

  const localPath = (path) => `${d.info().appDir}\\${path === APP_EXE ? d.info().exeName : path.replace(/\//g, "\\")}`;

  async function localHashes(app) {
    const out = {};
    for (const file of app.files) {
      try {
        out[file.path] = await sha256Hex(await d.core.fileReadBytes(localPath(file.path)));
      } catch {
        out[file.path] = "";
      }
    }
    return out;
  }

  async function check() {
    if (checked) return found;
    checked = true;
    if (navigator.onLine === false) return null;
    let got;
    try {
      got = await load();
    } catch (error) {
      d.log("WARN", `webGBA 업데이트 확인 실패: ${error?.code ?? error?.name ?? ""} ${error?.message ?? error}`);
      return null;
    }
    if (got.error) d.log("INFO", `업데이트 목록의 webGBA 항목 사용 안 함: ${got.error.message} → webGBA 버전 파일`);
    const app = got.app;
    if (!app) return null;
    const from = current();
    let newer = false;
    try {
      newer = compareVersions(app.version, from) > 0;
    } catch {
      newer = false;
    }
    if (!newer) return null;
    const plan = planApp(app, await localHashes(app));
    if (!plan.files.length) {
      d.log("INFO", `webGBA ${app.version} 파일이 지금 파일과 같음(표시 안 함)`);
      return null;
    }
    found = { app, plan, from, to: app.version };
    d.log("INFO", `webGBA 업데이트 있음 ${from} → ${app.version} · 파일 ${plan.files.map((f) => f.path).join(", ")} · ${plan.size}바이트`);
    return found;
  }

  async function install(paint) {
    const { plan } = found;
    const total = plan.size || 1;
    let got = 0;
    for (const [index, file] of plan.files.entries()) {
      const before = got;
      const bytes = await fetchAppFile(file, { onProgress: (n) => paint("download", ((before + n) / total) * GAUGE_DOWNLOAD) });
      got += file.get.size;
      await d.core.appUpdateStage(file.path, bytes, index === 0);
    }
    paint("install", GAUGE_DOWNLOAD);
    if (d.gameOpen()) await d.closeGame();
    await d.core.appUpdateInstall(found.to, found.from, plan.files.map((file) => file.path));
    paint("restart", 1);
    d.log("INFO", `webGBA 업데이트 설치 ${found.from} → ${found.to} → 다시 시작`);
    await d.shutdown();
  }

  async function open() {
    if (!found || shown) return null;
    shown = true;
    const make = (className, text) => Object.assign(document.createElement("p"), { className, textContent: text });
    const lead = make("dialog__lead", t("appUpdate.versions", { from: found.from, to: found.to }));
    const parts = [lead, make("", t("appUpdate.text", { size: sizeText(found.plan.size) }))];
    if (d.gameOpen()) parts.push(make("", t("appUpdate.running")));
    const state = make("aupd__state", "");
    state.hidden = true;
    const bar = document.createElement("span");
    bar.className = "upick__bar aupd__bar";
    bar.setAttribute("role", "progressbar");
    bar.setAttribute("aria-valuemin", "0");
    bar.setAttribute("aria-valuemax", "100");
    bar.hidden = true;
    const fill = Object.assign(document.createElement("span"), { className: "upick__fill" });
    bar.append(fill);
    parts.push(state, bar);
    let busy = false;
    let buttons = [];
    let fraction = 0;
    const paint = (stage, value) => {
      fraction = Math.max(fraction, Math.min(1, value));
      const percent = Math.floor(fraction * 100);
      state.hidden = false;
      bar.hidden = false;
      state.textContent = stage === "download" ? t("appUpdate.download", { percent }) : t(stage === "install" ? "appUpdate.install" : "appUpdate.restart");
      fill.style.setProperty("--progress", (percent / 100).toFixed(4));
      bar.setAttribute("aria-valuenow", String(percent));
    };
    const go = async () => {
      if (busy) return;
      busy = true;
      fraction = 0;
      state.classList.remove("aupd__state--why");
      for (const button of buttons) button.disabled = true;
      paint("download", 0);
      try {
        await install(paint);
      } catch (error) {
        d.log("WARN", `webGBA 업데이트 실패 ${found.from} → ${found.to}: ${error?.code ?? ""} ${error?.message ?? error}`);
        await d.core.appUpdateFinish().catch(() => {});
        bar.hidden = true;
        state.textContent = t("appUpdate.failed", { reason: updateErrorText(error) });
        state.classList.add("aupd__state--why");
        busy = false;
        for (const button of buttons) button.disabled = false;
      }
    };
    const asked = d.openDialog({
      title: t("appUpdate.title"),
      body: parts,
      kind: "app-update",
      actions: [
        { label: "LATER", value: false },
        { label: "UPDATE", go: true, run: go },
      ],
    });
    buttons = [...d.el.dialogActions.children];
    await asked;
    shown = false;
    return true;
  }

  return {
    prepare,
    check,
    open,
    get pending() {
      return found;
    },
  };
}
