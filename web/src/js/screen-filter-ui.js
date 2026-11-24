import {
  anyFilter,
  blankLook,
  BUILTIN,
  chainIsPlain,
  cleanLook,
  cleanStore,
  costLevel,
  costOf,
  crtFrameRadius,
  cssColorFilter,
  defaultsOf,
  detailOf,
  FILTERS,
  filterOf,
  FilterEngine,
  isNeutral,
  lightenPlan,
  loadLevel,
  loadScore,
  NAME_MAX,
  recommendLook,
  resolveChain,
  sameLook,
  SECTION_IDS,
  USER_MAX,
} from "./core/screen-filter.js";

const LOAD_CLS = ["lite", "mid", "heavy"];
const SLOW_FPS = 50;
const SLOW_SECONDS = 3;
const DPR_MAX = 2;
const THUMB_W = { pc: 76, phone: 70 };
const PAD = { a: 0, b: 1, y: 3, l: 4, r: 5, r3: 11, up: 12, down: 13, left: 14, right: 15 };
const deep = (o) => JSON.parse(JSON.stringify(o));
const pct = (v) => `${Math.round(v)}%`;

export function createScreenFilter(kit) {
  const { t, make, iconNode } = kit;
  let store = cleanStore(kit.prefs().screenFilter);
  const ui = { open: false, sec: null, compare: false, snapshot: null, padFid: "", reveal: null, sample: false };
  const gl = { engine: null, canvas: null, on: false, failed: false, warned: false, chain: null, ff: false, box: { w: 0, h: 0 } };
  const thumb = { engine: null, key: "", cache: new Map(), src: null };
  const slow = { at: 0, frames: 0, bad: 0, on: false };
  let radiusNow = 0;
  let panel = null;

  const game = () => kit.game();
  const phone = () => kit.phone();
  const sectionName = (sec) => t(`web.sf.sec.${sec}`);
  const filterName = (sec, id) => t(`web.sf.f.${sec}.${id}`);
  const costName = (lv) => t(`web.sf.cost.${lv}`);

  function save() {
    kit.savePrefs({ screenFilter: deep(store) });
  }

  function recOf() {
    const g = game();
    if (g?.gid && store.games[g.gid]) return { rec: store.games[g.gid], scope: "game" };
    if (g?.wapk) return { rec: { look: blankLook(), base: "orig" }, scope: "wapk" };
    return { rec: store.global, scope: "global" };
  }

  function editRec() {
    const g = game();
    const now = recOf();
    if (now.scope !== "wapk") return now.rec;
    store.games[g.gid] = { look: blankLook(), base: "orig", title: g.title };
    return store.games[g.gid];
  }

  function ctxOf() {
    const g = game();
    return { cssOnly: Boolean(g?.cssOnly), touch: Boolean(g?.touch), unsupported: false, ff: kit.ff(), phone: phone(), compare: ui.compare };
  }

  function presets() {
    const g = game();
    const out = [];
    const rec = g?.recommend ? recommendLook(g.recommend) : null;
    if (rec) out.push({ id: "rec", name: t("web.sf.tag.rec"), desc: t("web.sf.recDesc"), look: rec, tag: "rec" });
    for (const p of BUILTIN) out.push({ id: p.id, name: t(`web.sf.p.${p.id}`), desc: t(`web.sf.p.${p.id}.desc`), look: p.look });
    for (const u of store.user) out.push({ id: `user:${u.id}`, name: u.name, desc: t("web.sf.userDesc"), look: u.look, tag: "user", uid: u.id });
    return out;
  }

  const presetById = (id) => presets().find((p) => p.id === id) ?? null;

  function labelOf(rec) {
    const p = rec.base && presetById(rec.base);
    if (!p) return anyFilter(rec.look) ? t("web.sf.direct") : t("web.sf.p.orig");
    return sameLook(rec.look, p.look) ? p.name : t("web.sf.modified", { name: p.name });
  }

  // ---------------------------------------------------------------- 출력
  function ensureGl() {
    if (gl.engine && !gl.engine.lost) return true;
    if (gl.failed) return false;
    try {
      if (!gl.canvas) {
        gl.canvas = make("canvas", "sf-canvas");
        gl.canvas.setAttribute("aria-hidden", "true");
        gl.canvas.addEventListener("webglcontextlost", (event) => {
          event.preventDefault();
          fail();
        });
        kit.el.canvas.after(gl.canvas);
      }
      gl.engine = new FilterEngine(gl.canvas);
      return true;
    } catch {
      fail();
      return false;
    }
  }

  function fail() {
    gl.failed = true;
    gl.engine = null;
    setGl(false);
    if (!gl.warned) {
      gl.warned = true;
      kit.toast(t("web.sf.toast.gl"), "warn");
    }
    if (ui.open) render();
  }

  function setGl(on) {
    gl.on = on;
    const body = document.body;
    if (on) body.dataset.sf = ui.sample ? "sample" : "gl";
    else delete body.dataset.sf;
  }

  function boxSize() {
    const box = kit.el.screen.getBoundingClientRect();
    gl.box = { w: box.width, h: box.height };
    return gl.box;
  }

  function sourceOf() {
    if (ui.sample) return sampleCanvas();
    const c = kit.el.canvas;
    return c.width && c.height ? c : null;
  }

  function outRect(src) {
    const { w, h } = gl.box.w ? gl.box : boxSize();
    if (document.body.hasAttribute("data-stretch") || !src) return { x: 0, y: 0, w, h };
    const a = src.width / src.height;
    let ww = w;
    let hh = w / a;
    if (hh > h) {
      hh = h;
      ww = h * a;
    }
    return { x: (w - ww) / 2, y: (h - hh) / 2, w: ww, h: hh };
  }

  function draw({ ghostReset = false } = {}) {
    if (!gl.on || !gl.engine) return;
    const src = sourceOf();
    if (!src) return;
    const ff = kit.ff();
    if (ff !== gl.ff) {
      gl.ff = ff;
      gl.chain = resolveChain(recOf().rec.look, ctxOf());
    }
    const r = outRect(src);
    const dpr = Math.min(window.devicePixelRatio || 1, DPR_MAX);
    try {
      gl.engine.setSource(src, src.width, src.height);
      gl.engine.render(gl.chain, r.w * dpr, r.h * dpr, { ghostReset });
    } catch {
      fail();
      return;
    }
    const s = gl.canvas.style;
    const want = [`${r.x}px`, `${r.y}px`, `${r.w}px`, `${r.h}px`];
    if (s.left !== want[0] || s.top !== want[1] || s.width !== want[2] || s.height !== want[3]) [s.left, s.top, s.width, s.height] = want;
  }

  // 게임 화면이 그려질 때마다(WebPlayer.paint)
  function frame() {
    if (!gl.on) return;
    draw();
    noteSlow();
  }

  function noteSlow() {
    const now = performance.now();
    if (!slow.at) {
      slow.at = now;
      slow.frames = 0;
      return;
    }
    slow.frames++;
    const span = now - slow.at;
    if (span < 1000) return;
    if (span < 1500 && !kit.ff() && !kit.paused()) {
      slow.bad = (slow.frames * 1000) / span < SLOW_FPS ? slow.bad + 1 : 0;
      const on = slow.bad >= SLOW_SECONDS;
      if (on !== slow.on) {
        slow.on = on;
        syncButton();
      }
    }
    slow.at = now;
    slow.frames = 0;
  }

  function resetSlow() {
    slow.at = 0;
    slow.bad = 0;
    if (slow.on) {
      slow.on = false;
      syncButton();
    }
  }

  function cssFilter(chain) {
    const frameEl = game()?.frame;
    if (!frameEl) return;
    const value = chain ? cssColorFilter(chain) : "";
    if (frameEl.style.filter !== value) frameEl.style.filter = value;
  }

  // 설정 → 화면(GL·CSS)·테두리 반경·도구 버튼
  function apply({ ghostReset = true } = {}) {
    const g = game();
    const live = Boolean(g) || ui.sample;
    const ctx = ctxOf();
    const look = recOf().rec.look;
    const chain = live ? resolveChain(look, ctx) : null;
    gl.chain = chain;
    gl.ff = ctx.ff;
    if (g?.cssOnly) {
      setGl(false);
      cssFilter(chain);
    } else {
      cssFilter(null);
      const want = Boolean(chain) && !chainIsPlain(chain) && ensureGl();
      setGl(want);
      if (want) {
        boxSize();
        draw({ ghostReset });
      }
    }
    resetSlow();
    syncRadius();
    syncButton();
  }

  function syncRadius({ paint = true } = {}) {
    const g = game();
    const live = Boolean(g) || ui.sample;
    const box = gl.box.w ? gl.box : boxSize();
    const r = live && !g?.cssOnly && !gl.failed ? crtFrameRadius(recOf().rec.look, ctxOf(), box.w, box.h) : 0;
    const rounded = Math.round(r * 10) / 10;
    if (rounded === radiusNow) return;
    radiusNow = rounded;
    kit.el.screen.style.borderRadius = rounded ? `${rounded}px` : "";
    if (paint) kit.paintFrame();
  }

  // ---------------------------------------------------------------- 도구 버튼
  function syncButton() {
    const b = kit.el.btnFilter;
    if (!b) return;
    const { scope } = recOf();
    const g = game();
    const on = Boolean(g) && anyFilter(recOf().rec.look);
    const badge = b.querySelector(".tool__badge") ?? b.appendChild(make("span", "tool__badge"));
    const text = badge.querySelector(".tool__badgeText") ?? badge.appendChild(make("span", "tool__badgeText"));
    const badgeText = scope === "game" ? t("web.sf.gameBadge") : "";
    if (text.textContent !== badgeText) text.textContent = badgeText;
    if (badge.hidden !== !badgeText) badge.hidden = !badgeText;
    if (slow.on) badge.dataset.tone = "warn";
    else delete badge.dataset.tone;
    b.toggleAttribute("data-slow", slow.on);
    b.setAttribute("aria-pressed", String(ui.open));
    const label = slow.on ? "web.sf.buttonSlow" : scope === "game" ? "web.sf.buttonGame" : "web.sf.button";
    if (b.dataset.i18nTitle !== label) kit.setLabel(b, label);
    if (b.dataset.on !== String(on || ui.open)) {
      b.dataset.on = String(on || ui.open);
      kit.syncTools();
    }
  }

  const buttonOn = () => kit.el.btnFilter?.dataset.on === "true";

  // ---------------------------------------------------------------- 패널 열기·닫기
  function open() {
    if (ui.open) return;
    const g = game();
    ui.open = true;
    ui.sample = !g;
    ui.compare = false;
    ui.sec = null;
    ui.padFid = "";
    ui.snapshot = deep({ global: store.global, game: g?.gid ? store.games[g.gid] ?? null : null, gid: g?.gid ?? null });
    thumb.cache.clear();
    thumb.src = null;
    kit.hold("filter", true);
    ensurePanel();
    panel.hidden = false;
    kit.layout();
    render();
    apply();
    panel.querySelector('[data-fid="t-close"]')?.focus({ preventScroll: true });
  }

  function close() {
    if (!ui.open) return;
    ui.open = false;
    ui.compare = false;
    ui.sample = false;
    ui.sec = null;
    if (panel) {
      panel.hidden = true;
      panel.replaceChildren();
    }
    kit.hold("filter", false);
    kit.layout();
    apply();
    kit.el.btnFilter?.focus?.({ preventScroll: true });
  }

  const toggle = () => (ui.open ? close() : open());

  function ensurePanel() {
    if (panel) return;
    panel = make("aside", "fp");
    panel.id = "filterPanel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-labelledby", "fpTitle");
    panel.hidden = true;
    kit.el.app.append(panel);
  }

  function changed() {
    const s = ui.snapshot;
    if (!s) return false;
    const g = game();
    return JSON.stringify(s.global) !== JSON.stringify(store.global) || JSON.stringify(s.game) !== JSON.stringify(g?.gid ? store.games[g.gid] ?? null : null);
  }

  // 값 변경 공통: 저장 → 화면 반영 → (full 이면) 패널 다시 그리기
  function act(fn, { full = true } = {}) {
    fn();
    save();
    apply({ ghostReset: false });
    if (full && ui.open) render();
    else if (ui.open) refreshHead();
  }

  // ---------------------------------------------------------------- 패널 그리기
  function fid(node, id) {
    node.dataset.fid = id;
    return node;
  }

  function toolBtn(icon, label, id, onClick, { disabled = false, danger = false } = {}) {
    const b = make("button", `tool tool--small${danger ? " tool--danger" : ""}`);
    b.type = "button";
    b.title = label;
    b.setAttribute("aria-label", label);
    b.disabled = disabled;
    b.append(iconNode(icon));
    if (onClick) b.addEventListener("click", onClick);
    return fid(b, id);
  }

  function chip(text, cls = "") {
    const c = make("span", `fp-chip${cls ? ` ${cls}` : ""}`);
    c.append(make("span", "fp-chip__text", text));
    return c;
  }

  function banner(kind, title, text, extra = null) {
    const b = make("div", `fban${kind === "warn" ? " fban--warn" : ""}`);
    b.append(iconNode(kind === "warn" ? "warn" : "info"));
    const box = make("div", "fban__text");
    box.append(make("b", "fban__title", title), make("span", "fban__note", text));
    if (extra) box.append(extra);
    b.append(box);
    return b;
  }

  function group(title, ...kids) {
    const g = make("section", "fgroup");
    if (title) g.append(make("h3", "fgroup__title", title));
    g.append(...kids.filter(Boolean));
    return g;
  }

  function render() {
    if (!panel || !ui.open) return;
    const body0 = panel.querySelector(".fp__body");
    const scroll = body0 ? body0.scrollTop : 0;
    const focusFid = document.activeElement?.closest?.("#filterPanel") ? document.activeElement.dataset.fid : "";
    const g = game();
    const ctx = ctxOf();
    const { rec, scope } = recOf();
    const look = rec.look;
    panel.dataset.dock = kit.dock() || "right";
    panel.toggleAttribute("data-phone", phone());
    panel.classList.toggle("is-compare", ui.compare);
    const head = make("header", "fp__head");
    head.dataset.row = "tools";
    const title = make("h2", "fp__title", t("web.sf.title"));
    title.id = "fpTitle";
    const chipText = !g ? t("web.sf.chip.all") : scope === "game" ? t("web.sf.chip.game") : t("web.sf.chip.global");
    const compare = toolBtn("compare", t("web.sf.compare"), "t-compare", null);
    const holdOn = (on) => (event) => {
      if (event.type.startsWith("key")) {
        if (event.key !== " " && event.key !== "Enter") return;
        event.preventDefault();
        event.stopPropagation();
        if (event.repeat) return;
      }
      setCompare(on);
    };
    compare.addEventListener("pointerdown", holdOn(true));
    for (const type of ["pointerup", "pointerleave", "pointercancel", "blur"]) compare.addEventListener(type, holdOn(false));
    compare.addEventListener("keydown", holdOn(true));
    compare.addEventListener("keyup", holdOn(false));
    compare.addEventListener("contextmenu", (event) => event.preventDefault());
    head.append(
      title,
      chip(chipText, scope === "game" ? "fp-chip--game" : ""),
      make("span", "fp__grow"),
      compare,
      toolBtn("history", t("web.sf.undo"), "t-undo", () => undo(), { disabled: !changed() }),
      toolBtn("x", t("web.sf.close"), "t-close", () => close()),
    );
    const body = make("div", "fp__body");
    if (!g) body.append(banner("info", t("web.sf.ban.start"), t("web.sf.ban.startText")));
    if (ctx.cssOnly) body.append(banner("warn", t("web.sf.ban.css"), t("web.sf.ban.cssText", { name: g.title })));
    if (gl.failed && !ctx.cssOnly) body.append(banner("warn", t("web.sf.ban.gl"), t("web.sf.ban.glText")));
    if (g) {
      const seg = make("div", "seg fscope");
      seg.setAttribute("role", "radiogroup");
      seg.setAttribute("aria-label", t("web.sf.scope"));
      seg.dataset.row = "scope";
      const segBtn = (label, on, id, onClick) => {
        const b = make("button", "seg__btn");
        b.type = "button";
        b.setAttribute("role", "radio");
        b.setAttribute("aria-selected", String(on));
        b.setAttribute("aria-checked", String(on));
        b.append(make("span", "seg__label", label));
        b.addEventListener("click", onClick);
        return fid(b, id);
      };
      seg.append(
        segBtn(t("web.sf.scope.global"), scope !== "game", "scope-global", () => {
          if (scope === "game") askRelease();
        }),
        segBtn(t("web.sf.scope.game"), scope === "game", "scope-game", () => {
          if (scope !== "game") makeGameScope();
        }),
      );
      const note = scope === "game" ? t("web.sf.scope.noteGame", { name: g.title }) : scope === "wapk" ? t("web.sf.scope.noteWapk") : t("web.sf.scope.noteGlobal");
      body.append(group(t("web.sf.scope"), seg, make("p", `fnote${scope === "game" ? " fnote--game" : ""}`, note)));
    }
    const ls = loadScore(look, ctx);
    const level = loadLevel(ls.score, ls.heavy);
    if (ctx.phone && level === 2 && !ctx.cssOnly) {
      const plan = lightenPlan(look);
      const b = make("button", "btn btn--small");
      b.type = "button";
      b.dataset.row = "lighten";
      b.append(iconNode("refresh"), make("span", "btn__label", t("web.sf.lighten")));
      b.addEventListener("click", () => {
        act(() => plan.apply(editRec().look));
        kit.toast(t(`web.sf.lighten.${plan.what}`));
      });
      fid(b, "lighten");
      body.append(banner("warn", t("web.sf.ban.heavy"), t("web.sf.ban.heavyText", { what: t(`web.sf.what.${plan.what}`) }), b));
    } else if (slow.on) body.append(banner("warn", t("web.sf.ban.slow"), t("web.sf.ban.slowText")));
    if (ctx.ff) body.append(banner("info", t("web.sf.ban.ff"), ctx.phone ? t("web.sf.ban.ffTextPhone") : t("web.sf.ban.ffText")));
    body.append(presetGroup(rec, ctx));
    const secs = group(t("web.sf.secs"));
    secs.classList.add("fsecs");
    for (const sec of SECTION_IDS) secs.append(sectionView(sec, look, ctx));
    body.append(secs);
    const load = make("p", "fload");
    const tag = make("b", `fload__tag fload__tag--${LOAD_CLS[level]}`, costName(level));
    load.append(make("span", "", `${t("web.sf.load")} `), tag, make("span", "", ` · ${ctx.phone ? t("web.sf.loadPhone") : t("web.sf.loadPc")} · ${t("web.sf.loadNote")}`));
    body.append(load);
    const foot = make("footer", "fp__foot");
    foot.dataset.row = "foot";
    const saveBtn = make("button", "btn btn--primary");
    saveBtn.type = "button";
    saveBtn.append(iconNode("floppy"), make("span", "btn__label", t("web.sf.save")));
    saveBtn.addEventListener("click", () => askSave());
    const resetBtn = make("button", "btn btn--danger");
    resetBtn.type = "button";
    resetBtn.append(iconNode("refresh"), make("span", "btn__label", scope === "game" ? t("web.sf.release") : t("web.sf.reset")));
    resetBtn.addEventListener("click", () => (scope === "game" ? askRelease() : askReset()));
    foot.append(fid(saveBtn, "f-save"), fid(resetBtn, "f-reset"));
    panel.replaceChildren(head, body, foot);
    body.scrollTop = scroll;
    if (ui.reveal) {
      const target = body.querySelector(`.fsec[data-sec="${ui.reveal}"]`);
      ui.reveal = null;
      if (target) {
        const top = target.offsetTop - body.offsetTop;
        if (top + target.offsetHeight > body.scrollTop + body.clientHeight) body.scrollTop = Math.max(0, Math.min(top - 4, top + target.offsetHeight - body.clientHeight));
        if (top < body.scrollTop) body.scrollTop = top - 4;
      }
    }
    if (focusFid) panel.querySelector(`[data-fid="${CSS.escape(focusFid)}"]`)?.focus({ preventScroll: true });
    paintThumbs();
    padFocus();
  }

  function refreshHead() {
    const undoBtn = panel?.querySelector('[data-fid="t-undo"]');
    if (undoBtn) undoBtn.disabled = !changed();
  }

  function presetGroup(rec, ctx) {
    const list = presets();
    const g = game();
    const tiles = make("div", "ptiles");
    tiles.setAttribute("role", "radiogroup");
    tiles.setAttribute("aria-label", t("web.sf.presets", { n: BUILTIN.length, user: store.user.length, max: USER_MAX }));
    tiles.dataset.row = "presets";
    const tw = phone() ? THUMB_W.phone : THUMB_W.pc;
    const th = Math.round(tw / 1.5);
    for (const pre of list) {
      const on = rec.base === pre.id;
      const mod = on && !sameLook(rec.look, pre.look);
      const tile = make("button", `ptile${on ? " is-on" : ""}${mod ? " is-mod" : ""}`);
      tile.type = "button";
      tile.setAttribute("role", "radio");
      tile.setAttribute("aria-checked", String(on));
      tile.title = `${pre.name} — ${pre.desc}`;
      const cv = make("canvas", "ptile__cv");
      cv.dataset.look = JSON.stringify(pre.look);
      cv.style.width = `${tw}px`;
      cv.style.height = `${th}px`;
      tile.append(cv, make("span", "ptile__name", pre.name));
      if (pre.tag) tile.append(make("span", `ptile__tag${pre.tag === "user" ? " ptile__tag--user" : ""}`, pre.tag === "user" ? t("web.sf.tag.user") : t("web.sf.tag.rec")));
      if (mod) tile.append(make("span", "ptile__mod", t("web.sf.tag.mod")));
      tile.addEventListener("click", () => applyPreset(pre.id));
      tiles.append(fid(tile, `p-${pre.id}`));
    }
    const title = g?.recommend && recommendLook(g.recommend) ? t("web.sf.presetsRec", { n: BUILTIN.length, user: store.user.length, max: USER_MAX }) : t("web.sf.presets", { n: BUILTIN.length, user: store.user.length, max: USER_MAX });
    const out = group(title, tiles);
    const cur = rec.base && presetById(rec.base);
    if (cur?.uid) {
      const row = make("div", "fname");
      row.dataset.row = "uname";
      const input = make("input", "dialog__input fname__input");
      input.type = "text";
      input.maxLength = NAME_MAX;
      input.value = cur.name;
      input.autocomplete = "off";
      input.spellcheck = false;
      input.title = t("web.sf.rename");
      input.setAttribute("aria-label", t("web.sf.rename"));
      input.addEventListener("change", () =>
        act(() => {
          const u = store.user.find((x) => x.id === cur.uid);
          if (u) u.name = [...input.value.trim()].slice(0, NAME_MAX).join("") || u.name;
        }),
      );
      row.append(fid(input, "uname"), toolBtn("trash", t("web.sf.delete"), "udel", () => askDelete(cur.uid), { danger: true }));
      out.append(row);
    }
    return out;
  }

  function fmt(x, v) {
    switch (x.unit) {
      case "pct":
        return pct(v);
      case "signed":
        return `${v > 0 ? "+" : ""}${Math.round(v)}`;
      case "px10":
        return `${(v / 10).toFixed(1)}px`;
      case "dec10":
        return (v / 10).toFixed(1);
      case "dec100":
        return (v / 100).toFixed(2);
      case "levels":
        return t("web.sf.u.levels", { n: v });
      case "curve":
        return v ? pct(v) : t("web.sf.u.flat");
      default:
        return String(v);
    }
  }

  function range(min, max, step, value, label) {
    const r = make("input", "frange");
    r.type = "range";
    r.min = String(min);
    r.max = String(max);
    r.step = String(step);
    r.value = String(value);
    r.setAttribute("aria-label", label);
    r.style.setProperty("--fill", String((value - min) / (max - min)));
    return r;
  }

  function sectionView(sec, look, ctx) {
    const id = look[sec].id;
    const f = filterOf(sec, id);
    const d = detailOf(look, sec);
    const name = sectionName(sec);
    const locked = ctx.cssOnly && sec !== "color";
    const opened = ui.sec === sec && !locked;
    const neutral = isNeutral(sec, id);
    const disabled = neutral || locked;
    const sVal = look[sec].s;
    const el = make("div", `fsec${opened ? " is-open" : ""}${locked ? " is-locked" : ""}`);
    el.dataset.sec = sec;
    const headRow = make("div", "fsec__head");
    headRow.dataset.row = `sec-${sec}`;
    const toggleBtn = make("button", "fsec__toggle");
    toggleBtn.type = "button";
    toggleBtn.setAttribute("aria-expanded", String(opened));
    toggleBtn.disabled = locked;
    toggleBtn.title = locked ? t("web.sf.lockedTitle", { name }) : t(opened ? "web.sf.collapse" : "web.sf.expand", { name });
    if (!disabled) toggleBtn.dataset.adjust = `s-${sec}`;
    const names = make("span", "fsec__names");
    names.append(make("span", "fsec__name", name), make("span", "fsec__cur", locked ? t("web.sf.unsupported") : filterName(sec, id)));
    toggleBtn.append(iconNode("chevron"), names);
    toggleBtn.addEventListener("click", () => {
      ui.sec = opened ? null : sec;
      ui.reveal = opened ? null : sec;
      render();
    });
    const out = make("output", "fsec__val", disabled ? "—" : `${sVal}%`);
    const r = range(0, 100, 5, sVal, t("web.sf.strength", { name }));
    r.classList.add("fsec__range");
    r.classList.toggle("is-neutral", disabled);
    r.disabled = disabled;
    r.addEventListener("input", () => {
      const n = Number(r.value);
      r.style.setProperty("--fill", String(n / 100));
      out.textContent = `${n}%`;
      act(() => (editRec().look[sec].s = n), { full: false });
    });
    r.addEventListener("change", () => render());
    headRow.append(fid(toggleBtn, `sec-${sec}`), fid(r, `s-${sec}`), out);
    el.append(headRow);
    if (!opened) return el;
    const body = make("div", "fsec__body");
    const chips = make("div", "fchips");
    chips.setAttribute("role", "radiogroup");
    chips.setAttribute("aria-label", t("web.sf.chips", { name }));
    chips.dataset.row = `chips-${sec}`;
    for (const x of FILTERS[sec]) {
      const c = costOf(sec, x.id, detailOf({ ...look, [sec]: { ...look[sec], id: x.id } }, sec));
      const lockedChip = ctx.cssOnly && sec === "color" && !x.css && x.id !== "none";
      const b = make("button", "fchip");
      b.type = "button";
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", String(x.id === id));
      b.disabled = lockedChip;
      b.title = t(`web.sf.f.${sec}.${x.id}.desc`);
      b.append(make("span", "fchip__name", filterName(sec, x.id)));
      if (c >= 3) b.append(make("span", "fchip__heavy", costName(2)));
      b.addEventListener("click", () => act(() => (editRec().look[sec].id = x.id)));
      chips.append(fid(b, `c-${sec}-${x.id}`));
    }
    body.append(chips);
    const lv = costLevel(costOf(sec, id, d));
    const desc = make("p", "fdesc");
    desc.append(make("span", "", `${t(`web.sf.f.${sec}.${id}.desc`)} `), make("span", `fload__tag fload__tag--${LOAD_CLS[lv]}`, costName(lv)));
    body.append(desc);
    const fields = f.details.map((x) => detailField(sec, look, x, d, ctx)).filter(Boolean);
    if (fields.length) body.append(...fields);
    else body.append(make("p", "fnote fnote--empty", neutral ? t("web.sf.emptyNeutral", { name }) : t("web.sf.emptyNone", { name: filterName(sec, id) })));
    if (!neutral) {
      const isDefault = look[sec].s === 100 && Object.entries(defaultsOf(sec, id)).every(([k, v]) => d[k] === v);
      const foot = make("div", "fsec__foot");
      foot.dataset.row = `foot-${sec}`;
      const def = make("button", "btn btn--small");
      def.type = "button";
      def.disabled = isDefault;
      def.title = t("web.sf.defaultTitle", { name: filterName(sec, id) });
      def.append(iconNode("refresh"), make("span", "btn__label", t("web.sf.default")));
      def.addEventListener("click", () =>
        act(() => {
          const l = editRec().look;
          l[sec].s = 100;
          l[sec].d[id] = defaultsOf(sec, id);
        }),
      );
      foot.append(make("span", "fnote", t("web.sf.strengthNote", { note: t(`web.sf.sec.${sec}.note`) })), fid(def, `def-${sec}`));
      body.append(foot);
    }
    el.append(body);
    return el;
  }

  function detailField(sec, look, x, d, ctx) {
    if (x.when && !x.when(d)) return null;
    const id = look[sec].id;
    const v = d[x.k];
    const lock = x.lock ? x.lock(d, ctx) : null;
    const lockText = lock ? t(`web.sf.lock.${lock}`) : "";
    const key = `web.sf.d.${sec}.${id}.${x.k}`;
    const descOf = (val) => (x.descByValue ? t(`${key}.desc${val}`) : x.type === "chips" ? t(`web.sf.m.${val}`) : t(`${key}.desc`));
    const set = (val, full) => act(() => {
      const l = editRec().look;
      l[sec].d[id] = { ...detailOf(l, sec), [x.k]: val };
    }, { full });
    const label = make("span", "field__label", t(key));
    if (x.adv) label.append(make("span", "advtag", t("web.sf.adv")));
    const rowId = `d-${sec}-${id}-${x.k}`;
    const text = make("div", "field__text");
    if (x.type === "range") {
      const note = make("span", `field__note${lock ? " field__note--lock" : ""}`, lock ? lockText : `${fmt(x, v)} · ${descOf(v)}`);
      text.append(label, note);
      const r = range(x.min, x.max, x.step, v, t(key));
      r.disabled = Boolean(lock);
      r.setAttribute("aria-valuetext", fmt(x, v));
      r.addEventListener("input", () => {
        const n = Number(r.value);
        r.style.setProperty("--fill", String((n - x.min) / (x.max - x.min)));
        r.setAttribute("aria-valuetext", fmt(x, n));
        note.textContent = `${fmt(x, n)} · ${descOf(n)}`;
        set(n, false);
      });
      r.addEventListener("change", () => render());
      const row = make("div", `field fp-field${lock ? " field--off" : ""}`);
      row.dataset.row = rowId;
      row.append(text, fid(r, rowId));
      return row;
    }
    text.append(label, make("span", "field__note", descOf(v)));
    if (x.type === "switch") {
      const sw = make("button", "switch");
      sw.type = "button";
      sw.setAttribute("role", "switch");
      sw.setAttribute("aria-checked", String(Boolean(v)));
      sw.setAttribute("aria-label", t(key));
      sw.addEventListener("click", () => set(!v, true));
      const row = make("div", "field fp-field");
      row.dataset.row = rowId;
      row.append(text, fid(sw, rowId));
      return row;
    }
    if (x.type === "seg") {
      const seg = make("div", "seg seg--sm");
      seg.setAttribute("role", "radiogroup");
      seg.setAttribute("aria-label", t(key));
      for (const o of x.options) {
        const b = make("button", "seg__btn");
        b.type = "button";
        b.setAttribute("role", "radio");
        b.setAttribute("aria-selected", String(o.v === v));
        b.setAttribute("aria-checked", String(o.v === v));
        b.append(make("span", "seg__label", x.k === "levels" ? t("web.sf.u.levels", { n: o.v }) : t(`web.sf.o.${sec}.${id}.${x.k}.${o.v}`)));
        b.addEventListener("click", () => set(o.v, true));
        seg.append(fid(b, `${rowId}-${o.v}`));
      }
      const row = make("div", "field fp-field field--seg");
      row.dataset.row = rowId;
      row.append(text, seg);
      return row;
    }
    const grid = make("div", "fchips fchips--sub");
    grid.setAttribute("role", "radiogroup");
    grid.setAttribute("aria-label", t(key));
    grid.dataset.row = rowId;
    for (const o of x.options) {
      const b = make("button", "fchip");
      b.type = "button";
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", String(o.v === v));
      b.title = t(`web.sf.m.${o.v}`);
      b.append(make("span", "fchip__name", o.t));
      if (o.cost >= 3) b.append(make("span", "fchip__heavy", costName(2)));
      b.addEventListener("click", () => set(o.v, true));
      grid.append(fid(b, `${rowId}-${o.v}`));
    }
    const row = make("div", "field fp-field field--block");
    row.append(text, grid);
    return row;
  }

  // ---------------------------------------------------------------- 프리셋 칸 그림(현재 게임 화면 + 프리셋)
  function scriptSource() {
    const shot = kit.scriptThumb?.();
    if (!shot?.width) return sampleCanvas();
    const c = make("canvas");
    c.width = shot.width;
    c.height = shot.height;
    c.getContext("2d").putImageData(shot, 0, 0);
    return c;
  }

  function thumbSource() {
    if (thumb.src) return thumb.src;
    const cssOnly = Boolean(game()?.cssOnly);
    const src = cssOnly ? scriptSource() : sourceOf();
    if (!src) return null;
    const frac = ui.sample || cssOnly ? 1 : 0.62;
    const aspect = 1.5;
    let cw = Math.round(src.width * frac);
    let ch = Math.round(cw / aspect);
    if (ch > src.height) {
      ch = src.height;
      cw = Math.round(ch * aspect);
    }
    const c = make("canvas");
    c.width = cw;
    c.height = ch;
    c.getContext("2d").drawImage(src, Math.round((src.width - cw) / 2), Math.round((src.height - ch) / 2), cw, ch, 0, 0, cw, ch);
    thumb.src = c;
    return c;
  }

  function paintThumbs() {
    const tiles = panel?.querySelectorAll(".ptile__cv") ?? [];
    if (!tiles.length) return;
    const src = thumbSource();
    if (!src) return;
    if (!thumb.engine && !gl.failed) {
      try {
        thumb.engine = new FilterEngine(make("canvas"), { preserve: true });
      } catch {
        thumb.engine = null;
      }
    }
    const dpr = Math.min(window.devicePixelRatio || 1, DPR_MAX);
    const ctx = { ...ctxOf(), compare: false, ff: false };
    for (const cv of tiles) {
      const w = parseFloat(cv.style.width);
      const h = parseFloat(cv.style.height);
      const pw = Math.round(w * dpr);
      const ph = Math.round(h * dpr);
      cv.width = pw;
      cv.height = ph;
      const look = cleanLook(JSON.parse(cv.dataset.look));
      const chain = resolveChain(look, ctx);
      const key = `${pw}x${ph}|${JSON.stringify(chain)}`;
      let hit = thumb.cache.get(key);
      if (!hit) {
        hit = make("canvas");
        hit.width = pw;
        hit.height = ph;
        const g2 = hit.getContext("2d");
        if (thumb.engine && !chainIsPlain(chain)) {
          try {
            thumb.engine.setSource(src, src.width, src.height);
            thumb.engine.render(chain, pw, ph, { ghostReset: true });
            g2.drawImage(thumb.engine.canvas, 0, 0);
          } catch {
            g2.imageSmoothingEnabled = false;
            g2.drawImage(src, 0, 0, pw, ph);
          }
        } else {
          g2.imageSmoothingEnabled = false;
          g2.drawImage(src, 0, 0, pw, ph);
        }
        thumb.cache.set(key, hit);
      }
      cv.getContext("2d").drawImage(hit, 0, 0);
    }
  }

  let sampleC = null;
  function sampleCanvas() {
    if (sampleC) return sampleC;
    const c = make("canvas");
    c.width = 240;
    c.height = 160;
    const g = c.getContext("2d");
    for (let y = 0; y < 160; y += 8) {
      for (let x = 0; x < 240; x += 8) {
        g.fillStyle = (x + y) % 16 ? "#2b5f8a" : "#3f8a4f";
        g.fillRect(x, y, 8, 8);
      }
    }
    ["#f8f8f8", "#f8d030", "#58c8f0", "#58d058", "#f070c0", "#f05050", "#4060e0", "#202020"].forEach((col, i) => {
      g.fillStyle = col;
      g.fillRect(16 + i * 26, 14, 26, 30);
    });
    g.fillStyle = "#101820";
    g.fillRect(16, 56, 208, 88);
    g.fillStyle = "#f8f8f8";
    g.beginPath();
    g.arc(60, 100, 26, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#f05050";
    g.beginPath();
    g.moveTo(104, 128);
    g.lineTo(136, 70);
    g.lineTo(168, 128);
    g.fill();
    g.strokeStyle = "#f8d030";
    g.lineWidth = 2;
    for (let i = 0; i < 5; i++) {
      g.beginPath();
      g.moveTo(178 + i * 8, 66);
      g.lineTo(204 + i * 4, 134);
      g.stroke();
    }
    g.fillStyle = "#f8f8f8";
    g.font = '12px "Galmuri11"';
    g.fillText("SAMPLE", 112, 150);
    sampleC = c;
    return c;
  }

  // ---------------------------------------------------------------- 동작
  function applyPreset(id) {
    const pre = presetById(id);
    if (!pre) return;
    act(() => {
      const rec = editRec();
      rec.look = deep(pre.look);
      rec.base = id;
    });
  }

  function makeGameScope() {
    const g = game();
    if (!g?.gid) return;
    act(() => {
      const base = recOf();
      store.games[g.gid] = { look: deep(base.scope === "wapk" ? blankLook() : store.global.look), base: base.scope === "wapk" ? "orig" : store.global.base, title: g.title };
    });
    kit.toast(t("web.sf.made", { name: g.title }));
  }

  function undo() {
    const s = ui.snapshot;
    if (!s) return;
    act(() => {
      store.global = deep(s.global);
      if (s.gid) {
        if (s.game) store.games[s.gid] = deep(s.game);
        else delete store.games[s.gid];
      }
    });
    kit.toast(t("web.sf.undone"));
  }

  function setCompare(on) {
    if (ui.compare === on || !ui.open) return;
    ui.compare = on;
    panel?.classList.toggle("is-compare", on);
    apply({ ghostReset: true });
  }

  const actions = (okLabel, danger) => [
    { label: t("web.sf.btn.cancel"), value: false },
    { label: okLabel, value: true, primary: !danger, danger, id: "sf-ok" },
  ];

  async function askRelease(gid = game()?.gid) {
    const r = gid && store.games[gid];
    if (!r) return;
    const ok = await kit.openDialog({ title: t("web.sf.releaseTitle", { name: r.title || gid }), body: [t("web.sf.releaseText", { label: labelOf(store.global) })], actions: actions(t("web.sf.btn.reset"), true) });
    if (!ok) return;
    release(gid);
    kit.toast(t("web.sf.released"));
  }

  function release(gid) {
    act(() => delete store.games[gid]);
  }

  async function askReset() {
    const ok = await kit.openDialog({ title: t("web.sf.resetTitle"), body: [t("web.sf.resetText")], actions: actions(t("web.sf.btn.reset"), true) });
    if (!ok) return;
    act(() => (store.global = { look: blankLook(), base: "orig" }));
    kit.toast(t("web.sf.resetDone"));
  }

  async function askDelete(uid) {
    const u = store.user.find((x) => x.id === uid);
    if (!u) return;
    const ok = await kit.openDialog({ title: t("web.sf.deleteTitle", { name: u.name }), body: [t("web.sf.deleteText")], actions: actions(t("web.sf.btn.delete"), true) });
    if (!ok) return;
    act(() => {
      store.user = store.user.filter((x) => x.id !== uid);
      for (const r of [store.global, ...Object.values(store.games)]) if (r.base === `user:${uid}`) r.base = null;
    });
  }

  async function askSave() {
    const full = store.user.length >= USER_MAX;
    let pick = 0;
    const body = [t("web.sf.saveText", { max: USER_MAX })];
    if (full) {
      const seg = make("div", "seg seg--sm seg--wrap");
      seg.setAttribute("role", "radiogroup");
      store.user.forEach((u, i) => {
        const b = make("button", "seg__btn");
        b.type = "button";
        b.setAttribute("role", "radio");
        b.setAttribute("aria-selected", String(i === pick));
        b.append(make("span", "seg__label", u.name));
        b.addEventListener("click", () => {
          pick = i;
          for (const [j, n] of [...seg.children].entries()) n.setAttribute("aria-selected", String(j === pick));
        });
        seg.append(fid(b, `dl-pick-${i}`));
      });
      body.push(make("p", "note note--warn", t("web.sf.saveFull", { max: USER_MAX })), seg);
    }
    body.push(make("p", "dialog__label", t("web.sf.saveName", { max: NAME_MAX })));
    const fallback = t("web.sf.saveDefault", { n: store.user.length + 1 });
    const result = await kit.openDialog({
      title: t("web.sf.save"),
      body,
      input: { value: full ? store.user[0].name : fallback, maxLength: NAME_MAX },
      actions: [
        { label: t("web.sf.btn.cancel"), value: null },
        { label: t("web.sf.btn.save"), value: "save", primary: true, takeInput: true, id: "sf-save" },
      ],
    });
    if (!result?.action) return;
    const name = [...String(result.value).trim()].slice(0, NAME_MAX).join("") || (full ? store.user[pick].name : fallback);
    act(() => {
      const rec = editRec();
      let uid;
      if (full) {
        const u = store.user[pick];
        u.name = name;
        u.look = deep(rec.look);
        uid = u.id;
      } else {
        uid = `u${Date.now().toString(36)}${store.user.length}`;
        store.user.push({ id: uid, name, look: deep(rec.look) });
      }
      rec.base = `user:${uid}`;
    });
    kit.toast(t("web.sf.saved", { name }));
  }

  // ---------------------------------------------------------------- 설정 창 「화면」 그룹
  function settingsRows() {
    const g = game();
    const { rec, scope } = recOf();
    const summary = scope === "game" ? t("web.sf.cfgGame", { name: g.title, label: labelOf(rec) }) : t("web.sf.cfgGlobal", { label: labelOf(store.global) });
    const edit = make("button", "btn");
    edit.type = "button";
    edit.dataset.action = "sf-edit";
    edit.append(iconNode("pencil"), make("span", "btn__label", t("web.sf.cfgEdit")));
    edit.addEventListener("click", () => {
      kit.closeSheet();
      open();
    });
    const rows = [kit.field(t("web.sf.title"), summary, edit)];
    const entries = Object.entries(store.games);
    const sub = make("div", "cfg-sub");
    const subText = make("div", "cfg-sub__text");
    subText.append(make("span", "cfg-sub__label", t("web.sf.cfgGames")), make("span", "cfg-sub__note", entries.length ? t("web.sf.cfgGamesNote", { n: entries.length }) : t("web.sf.cfgGamesNone")));
    sub.append(subText);
    rows.push(sub);
    if (entries.length) {
      const list = make("ul", "glist");
      for (const [gid, r] of entries) {
        const li = make("li", "glist__item");
        const name = make("span", "glist__name", r.title || gid);
        if (g?.gid === gid) name.append(chip(t("web.sf.cfgRunning"), "fp-chip--game"));
        const del = toolBtn("trash", t("web.sf.cfgDelete", { name: r.title || gid }), `gdel-${gid}`, () => {
          release(gid);
          kit.renderSheet();
        }, { danger: true });
        li.append(name, make("span", "glist__meta", labelOf(r)), del);
        list.append(li);
      }
      rows.push(list);
    }
    return rows;
  }

  // ---------------------------------------------------------------- 게임패드
  const navRows = () => {
    const layer = kit.dialogOpen() ? document.getElementById("dialog") : panel;
    if (!layer) return [];
    if (kit.dialogOpen()) {
      const items = [...layer.querySelectorAll("button, input")].filter((n) => !n.disabled && n.offsetParent !== null);
      return items.length ? [items] : [];
    }
    const rows = [];
    for (const r of layer.querySelectorAll("[data-row]")) {
      const items = [...(r.hasAttribute("data-fid") ? [r] : r.querySelectorAll("[data-fid]"))].filter((n) => !n.disabled && n.offsetParent !== null && !n.classList.contains("fsec__range"));
      if (items.length) rows.push(items);
    }
    return rows;
  };

  let padOn = false;
  function padFocus() {
    for (const n of document.querySelectorAll(".fp .is-focus, .dialog .is-focus")) n.classList.remove("is-focus");
    if (!padOn || !ui.open) return;
    const rows = navRows();
    if (!rows.length) return;
    let el = ui.padFid ? rows.flat().find((n) => n.dataset.fid === ui.padFid) : null;
    if (!el) el = panel.querySelector(".ptile.is-on") ?? rows[0][0];
    ui.padFid = el.dataset.fid ?? "";
    el.classList.add("is-focus");
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  function padAction(action, down = true) {
    if (action === "y") {
      if (ui.open && !kit.dialogOpen()) setCompare(down);
      return;
    }
    if (!down) return;
    if (action === "r3") {
      if (kit.dialogOpen()) return;
      toggle();
      return;
    }
    if (!ui.open) return;
    padOn = true;
    if (kit.dialogOpen()) {
      if (action === "b") kit.dialogCancel();
      else if (action === "a") document.activeElement?.click?.();
      else if (action === "left" || action === "right") {
        const items = navRows()[0] ?? [];
        const i = items.indexOf(document.activeElement);
        items[Math.max(0, Math.min(items.length - 1, i + (action === "right" ? 1 : -1)))]?.focus();
      }
      return;
    }
    if (action === "l" || action === "r") {
      const list = presets();
      const i = list.findIndex((p) => p.id === recOf().rec.base);
      const next = list[(i + (action === "r" ? 1 : -1) + list.length) % list.length];
      ui.padFid = `p-${next.id}`;
      applyPreset(next.id);
      return;
    }
    if (action === "b") {
      if (ui.sec) {
        ui.padFid = `sec-${ui.sec}`;
        ui.sec = null;
        render();
      } else close();
      return;
    }
    const rows = navRows();
    if (!rows.length) return;
    const cur = rows.flat().find((n) => n.dataset.fid === ui.padFid);
    let ri = rows.findIndex((r) => r.includes(cur));
    if (ri < 0) ri = 0;
    const ii = Math.max(0, rows[ri].indexOf(cur));
    const el = rows[ri][ii];
    if (action === "up" || action === "down") {
      const nr = Math.max(0, Math.min(rows.length - 1, ri + (action === "down" ? 1 : -1)));
      ui.padFid = rows[nr][Math.min(ii, rows[nr].length - 1)].dataset.fid;
      padFocus();
    } else if (action === "left" || action === "right") {
      const dir = action === "right" ? 1 : -1;
      const target = el?.type === "range" ? el : el?.dataset.adjust ? panel.querySelector(`[data-fid="${el.dataset.adjust}"]`) : null;
      if (target && !target.disabled) {
        target.value = String(Number(target.value) + dir * Number(target.step || 1));
        target.dispatchEvent(new Event("input", { bubbles: true }));
        target.dispatchEvent(new Event("change", { bubbles: true }));
      } else {
        ui.padFid = rows[ri][Math.max(0, Math.min(rows[ri].length - 1, ii + dir))].dataset.fid;
        padFocus();
      }
    } else if (action === "a" && el && el.type !== "range" && el.type !== "text") {
      ui.padFid = el.dataset.fid;
      el.click();
    }
  }

  const padState = { prev: {}, raf: 0, again: 0 };
  function readPad() {
    const s = {};
    for (const gp of navigator.getGamepads?.() ?? []) {
      if (!gp) continue;
      for (const [name, i] of Object.entries(PAD)) if (gp.buttons[i]?.pressed) s[name] = true;
      const x = gp.axes[0] ?? 0;
      const y = gp.axes[1] ?? 0;
      if (y < -0.5) s.up = true;
      if (y > 0.5) s.down = true;
      if (x < -0.5) s.left = true;
      if (x > 0.5) s.right = true;
    }
    return s;
  }

  function padTick(now) {
    padState.raf = 0;
    const pads = navigator.getGamepads?.() ?? [];
    if (![...pads].some(Boolean)) return;
    const s = readPad();
    const p = padState.prev;
    const usable = (Boolean(game()) || ui.open) && !kit.sheetOpen();
    if (usable) {
      if (s.r3 && !p.r3 && !kit.padTaken(PAD.r3)) padAction("r3");
      if (ui.open) {
        if (Boolean(s.y) !== Boolean(p.y)) padAction("y", Boolean(s.y));
        for (const name of ["a", "b", "l", "r"]) if (s[name] && !p[name]) padAction(name);
        const dir = ["up", "down", "left", "right"].find((n) => s[n]);
        const was = ["up", "down", "left", "right"].find((n) => p[n]);
        if (dir && dir !== was) {
          padAction(dir);
          padState.again = now + 380;
        } else if (dir && now >= padState.again) {
          padAction(dir);
          padState.again = now + 110;
        }
      }
    }
    padState.prev = s;
    padState.raf = requestAnimationFrame(padTick);
  }

  function watchPads() {
    if (!navigator.getGamepads) return;
    const start = () => {
      if (!padState.raf) padState.raf = requestAnimationFrame(padTick);
    };
    window.addEventListener("gamepadconnected", start);
    if ([...(navigator.getGamepads() ?? [])].some(Boolean)) start();
  }

  // ---------------------------------------------------------------- 게임 열기·닫기·크기
  function onGame() {
    const g = game();
    if (ui.open) close();
    const r = g?.gid ? store.games[g.gid] : null;
    apply();
    if (r) kit.toast(t("web.sf.applied", { name: g.title, label: labelOf(r) }));
  }

  function onClosed() {
    if (ui.open) close();
    apply();
  }

  function onResize() {
    boxSize();
    syncRadius({ paint: false });
    if (gl.on) draw();
    if (ui.open && panel) {
      panel.dataset.dock = kit.dock() || "right";
      panel.toggleAttribute("data-phone", phone());
    }
  }

  function onKey(event) {
    if (!ui.open) return false;
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
    padOn = false;
    padFocus();
    return true;
  }

  function reload() {
    store = cleanStore(kit.prefs().screenFilter);
    apply();
    if (ui.open) render();
  }

  watchPads();

  return {
    frame,
    apply,
    open,
    close,
    toggle,
    onGame,
    onClosed,
    onResize,
    onKey,
    reload,
    settingsRows,
    buttonOn,
    radius: () => radiusNow,
    get isOpen() {
      return ui.open;
    },
    get glOn() {
      return gl.on;
    },
    debug: () => ({ store: deep(store), ui: { open: ui.open, sec: ui.sec, compare: ui.compare, sample: ui.sample }, gl: { on: gl.on, failed: gl.failed, passes: gl.engine?.passes ?? 0, cpuMs: gl.engine?.cpuMs ?? 0, chain: gl.chain }, radius: radiusNow, slow: slow.on, rec: recOf() }),
    padAction,
    engine: () => gl.engine,
  };
}
