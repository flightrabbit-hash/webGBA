const params = new URLSearchParams(location.search);
const glue = params.get("js") ?? "";
const lang = /^(ko|en|ja)$/.test(params.get("lang") ?? "") ? params.get("lang") : "ko";
const canvas = document.getElementById("canvas");
const statusEl = document.getElementById("status");
const root = `${location.origin}/`;

let words = {};

const t = (key, vars = {}) => (words[key] ?? key).replace(/\{(\w+)\}/g, (whole, name) => (name in vars ? String(vars[name]) : whole));

const setStatus = (text) => {
  statusEl.textContent = text ?? "";
  statusEl.hidden = !text;
};

const post = (message) => {
  try {
    window.parent.postMessage(message, "*");
  } catch {}
};

const config = {
  canvas,
  arguments: [],
  locateFile: (name) => new URL(name, root).href,
  print: (text) => console.log(text),
  printErr: (text) => console.warn(text),
  setStatus,
  monitorRunDependencies: () => {},
  onAbort: (what) => {
    setStatus(t("web.aborted", { what }));
    post({ type: "webgba:error", message: String(what) });
  },
};

async function loadWords() {
  for (const id of new Set(["ko", lang])) {
    try {
      const response = await fetch(`/__webgba__/i18n/${id}.json`);
      if (response.ok) words = { ...words, ...(await response.json()) };
    } catch {}
  }
  document.documentElement.lang = lang;
}

function loadScript(url) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = url;
    script.onload = resolve;
    script.onerror = () => reject(new Error(t("web.glueFailed", { glue })));
    document.head.append(script);
  });
}

function factoryAmong(names) {
  const functions = names.filter((name) => {
    try {
      return typeof window[name] === "function";
    } catch {
      return false;
    }
  });
  return functions.find((name) => /moduleArg|Module/.test(String(window[name]).slice(0, 600))) ?? functions[0] ?? null;
}

async function boot() {
  canvas.focus();
  await loadWords();
  if (!glue || /[\\/]|^\.\./.test(glue)) {
    setStatus(t("web.noGlue"));
    return;
  }
  document.title = glue.replace(/\.m?js$/i, "");
  const url = new URL(glue, root).href;
  if (/\.mjs$/i.test(glue)) {
    const mod = await import(url);
    const factory = mod.default ?? Object.values(mod).find((value) => typeof value === "function");
    if (typeof factory !== "function") throw new Error(t("web.noFactory"));
    await factory(config);
    return;
  }
  const before = new Set(Object.getOwnPropertyNames(window));
  window.Module = config;
  await loadScript(url);
  if (typeof window.Module === "function") {
    await window.Module(config);
    return;
  }
  const fresh = Object.getOwnPropertyNames(window).filter((name) => !before.has(name) && name !== "Module");
  const factory = factoryAmong(fresh);
  if (factory) await window[factory](config);
}

canvas.addEventListener("click", () => canvas.focus());
canvas.addEventListener("contextmenu", (event) => event.preventDefault());

boot().catch((error) => {
  setStatus(String(error?.message ?? error));
  post({ type: "webgba:error", message: String(error?.message ?? error) });
});
