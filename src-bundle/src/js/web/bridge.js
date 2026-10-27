(() => {
  if (window.__WEBGBA_BRIDGE__) return;
  window.__WEBGBA_BRIDGE__ = true;

  let parentOrigin = "";
  try {
    parentOrigin = new URL(document.referrer).origin;
  } catch {
    parentOrigin = "";
  }
  const trusted = (event) => event.source === window.parent && (!parentOrigin || event.origin === parentOrigin);
  const post = (message) => {
    try {
      window.parent.postMessage(message, parentOrigin || "*");
    } catch {}
  };

  const target = () => {
    const active = document.activeElement;
    if (active && active !== document.body && active !== document.documentElement) return active;
    return document.querySelector("canvas") ?? document.body ?? document.documentElement;
  };

  window.addEventListener("message", (event) => {
    if (!trusted(event)) return;
    const data = event.data;
    if (data?.type === "webgba:key") {
      const init = {
        key: data.key,
        code: data.code,
        keyCode: data.keyCode,
        which: data.keyCode,
        shiftKey: Boolean(data.shiftKey),
        ctrlKey: Boolean(data.ctrlKey),
        altKey: Boolean(data.altKey),
        bubbles: true,
        cancelable: true,
      };
      target().dispatchEvent(new KeyboardEvent(data.kind === "keyup" ? "keyup" : "keydown", init));
    } else if (data?.type === "webgba:focus") {
      window.focus();
      const canvas = document.querySelector("canvas");
      if (canvas && !canvas.hasAttribute("tabindex")) canvas.setAttribute("tabindex", "0");
      (canvas ?? document.body)?.focus?.();
    }
  });

  const report = () => post({ type: "webgba:title", title: document.title });
  window.addEventListener("load", report);
  window.addEventListener("error", (event) => post({ type: "webgba:error", message: String(event.message ?? "") }));
  window.addEventListener("unhandledrejection", (event) => post({ type: "webgba:error", message: String(event.reason?.message ?? event.reason ?? "") }));
})();
