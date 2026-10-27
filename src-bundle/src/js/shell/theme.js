export const KEYS = [
  "--bg", "--bg-sunken", "--bg-raised", "--bg-hover", "--bg-active",
  "--bg-deep", "--bg-tint", "--bg-lift", "--bg-glow",
  "--bg-palette-head", "--bg-palette-group", "--bg-palette-hover", "--bg-palette-title", "--line-palette-group",
  "--line", "--line-strong", "--line-mid", "--line-soft", "--line-faint",
  "--text", "--text-dim", "--text-faint", "--text-hi",
  "--accent", "--accent-hi", "--accent-lo",
  "--on", "--on-hi", "--off",
  "--danger", "--danger-hi", "--global", "--global-hi", "--run", "--run-hi", "--macro",
  "--accent-soft", "--on-soft", "--danger-soft", "--global-soft", "--run-soft",
  "--ink-accent", "--ink-on", "--ink-run", "--ink-danger", "--ink-global",
  "--accent-line", "--accent-fill", "--accent-ink",
  "--on-line", "--on-fill",
  "--danger-line", "--danger-line-hi", "--danger-fill", "--danger-fill-hi", "--danger-ink",
  "--run-line", "--run-fill",
  "--scroll", "--scroll-hi",
  "--accent-veil", "--on-veil", "--danger-edge",
  "--scrim", "--glass", "--glass-soft", "--tip-bg", "--tip-shadow",
  "--shadow-md", "--shadow-lg",
  "--drop-veil", "--drop-line", "--drop-ink",
];

const DARK = snapshot();

function snapshot() {
  const root = document.documentElement;
  const held = new Map();

  for (const key of KEYS) {
    const inline = root.style.getPropertyValue(key);
    if (inline) {
      held.set(key, inline);
      root.style.removeProperty(key);
    }
  }

  try {
    const style = getComputedStyle(root);
    const out = {};
    for (const key of KEYS) {
      const value = style.getPropertyValue(key).trim();
      if (value) out[key] = value;
    }
    return out;
  } finally {
    for (const [key, value] of held) root.style.setProperty(key, value);
  }
}

const LIGHT = {
  "--bg": "#f4f6fb", "--bg-sunken": "#ffffff", "--bg-raised": "#ffffff",
  "--bg-hover": "#e9edf6", "--bg-active": "#dbe4f7",
  "--bg-deep": "#eef1f8", "--bg-tint": "#e4e9f4", "--bg-lift": "#e9edf6", "--bg-glow": "#dbe4f7",
  "--bg-palette-head": "#ffffff", "--bg-palette-group": "#f0f4ff", "--bg-palette-hover": "#e8edf8", "--bg-palette-title": "#f2f5fc",
  "--line-palette-group": "#b7bece",
  "--line": "#c7cddb", "--line-strong": "#abb4ca", "--line-mid": "#c7cfe2",
  "--line-soft": "#aab4cc", "--line-faint": "#98a3bd",
  "--text": "#141a2c", "--text-dim": "#4a5573", "--text-faint": "#656f8a", "--text-hi": "#000814",
  "--accent": "#2f5fd8", "--accent-hi": "#2655cd", "--accent-lo": "#254bb0",
  "--on": "#00773e", "--on-hi": "#006e35", "--off": "#919cb6",
  "--danger": "#d02a2a", "--danger-hi": "#c51a1f",
  "--global": "#986600", "--global-hi": "#8d5e00",
  "--run": "#6b3fd0", "--run-hi": "#6334c5",
  "--macro": "#005b44",
  "--accent-soft": "rgba(47, 95, 216, 0.10)",
  "--on-soft": "rgba(0, 119, 62, 0.10)",
  "--danger-soft": "rgba(208, 42, 42, 0.10)",
  "--global-soft": "rgba(152, 102, 0, 0.12)",
  "--run-soft": "rgba(107, 63, 208, 0.10)",
  "--ink-accent": "#ffffff", "--ink-on": "#ffffff", "--ink-run": "#ffffff",
  "--ink-danger": "#ffffff", "--ink-global": "#ffffff",
  "--accent-line": "#9fb4ec", "--accent-fill": "#dde5fb", "--accent-ink": "#1c3a86",
  "--on-line": "#8ed3b0", "--on-fill": "#dcf3e8",
  "--danger-line": "#eaa8a8", "--danger-line-hi": "#dc7d7d",
  "--danger-fill": "#fbe2e2", "--danger-fill-hi": "#f6cccc", "--danger-ink": "#8b1b1b",
  "--run-line": "#e3daf8", "--run-fill": "#eee7fb",
  "--scroll": "#c1cadd", "--scroll-hi": "#a5b1c9",
  "--accent-veil": "rgba(47, 95, 216, 0.18)",
  "--on-veil": "rgba(0, 119, 62, 0.18)",
  "--danger-edge": "rgba(208, 42, 42, 0.40)",
  "--scrim": "rgba(20, 26, 44, 0.34)",
  "--glass": "rgba(20, 26, 44, 0.05)",
  "--glass-soft": "rgba(20, 26, 44, 0.04)",
  "--tip-bg": "rgba(255, 255, 255, 0.98)",
  "--tip-shadow": "0 8px 22px rgba(20, 26, 44, 0.16)",
  "--shadow-md": "0 4px 14px rgba(20, 26, 44, 0.10)",
  "--shadow-lg": "0 18px 44px rgba(20, 26, 44, 0.16)",
  "--drop-veil": "rgba(244, 246, 251, 0.66)", "--drop-line": "#2f5fd8", "--drop-ink": "#141a2c",
};

const RAGDOLL = {
  "--bg": "#fef9f1", "--bg-sunken": "#ffffff", "--bg-raised": "#ffffff",
  "--bg-hover": "#efe7db", "--bg-active": "#e4d8c8",
  "--bg-deep": "#f0e9de", "--bg-tint": "#f2ebe2", "--bg-lift": "#efe7db", "--bg-glow": "#e4d8c8",
  "--bg-palette-head": "#f3eadc", "--bg-palette-group": "#fdf4e6", "--bg-palette-hover": "#fffdfa", "--bg-palette-title": "#ead9c2",
  "--line-palette-group": "#a19482",
  "--line": "#dbcfc0", "--line-strong": "#c1b4a4", "--line-mid": "#cfc2b0",
  "--line-soft": "#bbae9b", "--line-faint": "#877c6e",
  "--text": "#1f1f1f", "--text-dim": "#5f5f5f", "--text-faint": "#6e665c", "--text-hi": "#241d17",
  "--accent": "#3270b3", "--accent-hi": "#2967a9", "--accent-lo": "#255890",
  "--on": "#376e44", "--on-hi": "#2d643a", "--off": "#a2937f",
  "--danger": "#b8544c", "--danger-hi": "#ad4a43",
  "--global": "#956300", "--global-hi": "#8b5a00",
  "--run": "#7969b3", "--run-hi": "#7060a9",
  "--macro": "#00583f",
  "--accent-soft": "rgba(50, 112, 179, 0.12)",
  "--on-soft": "rgba(55, 110, 68, 0.12)",
  "--danger-soft": "rgba(184, 84, 76, 0.12)",
  "--global-soft": "rgba(149, 99, 0, 0.14)",
  "--run-soft": "rgba(121, 105, 179, 0.12)",
  "--ink-accent": "#fffdf9", "--ink-on": "#fffdf9", "--ink-run": "#fffdf9",
  "--ink-danger": "#fffdf9", "--ink-global": "#fffdf9",
  "--accent-line": "#a8c4e0", "--accent-fill": "#dfeaf5", "--accent-ink": "#28527f",
  "--on-line": "#a9c9b0", "--on-fill": "#e2efe4",
  "--danger-line": "#e0b2ad", "--danger-line-hi": "#cf9089",
  "--danger-fill": "#f6e3e1", "--danger-fill-hi": "#efd0cc", "--danger-ink": "#7d3630",
  "--run-line": "#ded8ee", "--run-fill": "#ebe6f5",
  "--scroll": "#cdbfab", "--scroll-hi": "#b3a189",
  "--accent-veil": "rgba(50, 112, 179, 0.20)",
  "--on-veil": "rgba(55, 110, 68, 0.20)",
  "--danger-edge": "rgba(184, 84, 76, 0.42)",
  "--scrim": "rgba(59, 50, 42, 0.34)",
  "--glass": "rgba(59, 50, 42, 0.05)",
  "--glass-soft": "rgba(59, 50, 42, 0.04)",
  "--tip-bg": "rgba(255, 253, 249, 0.98)",
  "--tip-shadow": "0 8px 22px rgba(59, 50, 42, 0.18)",
  "--shadow-md": "0 4px 14px rgba(59, 50, 42, 0.10)",
  "--shadow-lg": "0 18px 44px rgba(59, 50, 42, 0.18)",
  "--drop-veil": "rgba(246, 241, 233, 0.66)", "--drop-line": "#3270b3", "--drop-ink": "#3b322a",
};

const MIDNIGHT = {
  "--bg": "#05070c", "--bg-sunken": "#000000", "--bg-raised": "#0d1120",
  "--bg-hover": "#171d2e", "--bg-active": "#202840",
  "--bg-deep": "#000000", "--bg-tint": "#0a0e18", "--bg-lift": "#141a2c", "--bg-glow": "#1b2338",
  "--bg-palette-head": "#010309", "--bg-palette-group": "#04060f", "--bg-palette-hover": "#111620", "--bg-palette-title": "#0a0e18",
  "--line-palette-group": "#2b3344",
  "--line": "#333a4d", "--line-strong": "#4a5268", "--line-mid": "#3d4458",
  "--line-soft": "#565f78", "--line-faint": "#6b7590",
  "--text": "#f5f7fc", "--text-dim": "#d4d9e6", "--text-faint": "#a8b0c4", "--text-hi": "#ffffff",
  "--accent": "#4da3ff", "--accent-hi": "#7cc0ff", "--accent-lo": "#2f7fdb",
  "--on": "#33e08a", "--on-hi": "#5cf0a8", "--off": "#6b7590",
  "--danger": "#ff4d4d", "--danger-hi": "#ff7a7a",
  "--global": "#ffcc33", "--global-hi": "#ffdb66",
  "--run": "#b98cff", "--run-hi": "#cba8ff",
  "--macro": "#00c1a1",
  "--accent-soft": "rgba(77, 163, 255, 0.16)",
  "--on-soft": "rgba(51, 224, 138, 0.16)",
  "--danger-soft": "rgba(255, 77, 77, 0.16)",
  "--global-soft": "rgba(255, 204, 51, 0.16)",
  "--run-soft": "rgba(185, 140, 255, 0.18)",
  "--ink-accent": "#00030a", "--ink-on": "#001a0d", "--ink-run": "#14081f",
  "--ink-danger": "#2a0505", "--ink-global": "#2a1e00",
  "--accent-line": "#3f6fb0", "--accent-fill": "#16233d", "--accent-ink": "#cfe3ff",
  "--on-line": "#1f8f5c", "--on-fill": "#0c2419",
  "--danger-line": "#a33f3f", "--danger-line-hi": "#c25050",
  "--danger-fill": "#341414", "--danger-fill-hi": "#250d0d", "--danger-ink": "#ffb3b3",
  "--run-line": "#4a3a78", "--run-fill": "#241a3d",
  "--scroll": "#333a4d", "--scroll-hi": "#454e66",
  "--accent-veil": "rgba(77, 163, 255, 0.28)",
  "--on-veil": "rgba(51, 224, 138, 0.28)",
  "--danger-edge": "rgba(255, 77, 77, 0.50)",
  "--scrim": "rgba(0, 0, 0, 0.72)",
  "--glass": "rgba(255, 255, 255, 0.08)",
  "--glass-soft": "rgba(255, 255, 255, 0.05)",
  "--tip-bg": "rgba(13, 17, 32, 0.98)",
  "--tip-shadow": "0 8px 22px rgba(0, 0, 0, 0.60)",
  "--shadow-md": "0 4px 14px rgba(0, 0, 0, 0.55)",
  "--shadow-lg": "0 18px 44px rgba(0, 0, 0, 0.70)",
  "--drop-veil": "rgba(5, 7, 12, 0.66)", "--drop-line": "#4da3ff", "--drop-ink": "#f5f7fc",
};

const SEPIA = {
  "--bg": "#f1e6cf", "--bg-sunken": "#faf3e3", "--bg-raised": "#faf3e3",
  "--bg-hover": "#e8dab8", "--bg-active": "#dcc9a0",
  "--bg-deep": "#ece0c5", "--bg-tint": "#e4d5b3", "--bg-lift": "#e8dab8", "--bg-glow": "#dcc9a0",
  "--bg-palette-head": "#ffffff", "--bg-palette-group": "#fdf4de", "--bg-palette-hover": "#f5ecd7", "--bg-palette-title": "#f0e4c8",
  "--line-palette-group": "#bfad83",
  "--line": "#d1be98", "--line-strong": "#b89d6f", "--line-mid": "#c6b085",
  "--line-soft": "#a68c5f", "--line-faint": "#94794f",
  "--text": "#3a2e1c", "--text-dim": "#6b5738", "--text-faint": "#766443", "--text-hi": "#241b0d",
  "--accent": "#975913", "--accent-hi": "#8d5001", "--accent-lo": "#79450d",
  "--on": "#3e6829", "--on-hi": "#345e1e", "--off": "#a68c5f",
  "--danger": "#b3402a", "--danger-hi": "#a83620",
  "--global": "#836200", "--global-hi": "#785900",
  "--run": "#6f5a9e", "--run-hi": "#665194",
  "--macro": "#005533",
  "--accent-soft": "rgba(151, 89, 19, 0.12)",
  "--on-soft": "rgba(62, 104, 41, 0.12)",
  "--danger-soft": "rgba(179, 64, 42, 0.12)",
  "--global-soft": "rgba(131, 98, 0, 0.14)",
  "--run-soft": "rgba(111, 90, 158, 0.12)",
  "--ink-accent": "#fdf7ec", "--ink-on": "#fdf7ec", "--ink-run": "#fdf7ec",
  "--ink-danger": "#fdf7ec", "--ink-global": "#fdf7ec",
  "--accent-line": "#d3ab72", "--accent-fill": "#f0dfc0", "--accent-ink": "#6b3c10",
  "--on-line": "#a8c79a", "--on-fill": "#e3ecda",
  "--danger-line": "#dba898", "--danger-line-hi": "#cf8a76",
  "--danger-fill": "#f5ded4", "--danger-fill-hi": "#eec7b8", "--danger-ink": "#7a2c1a",
  "--run-line": "#cec2e6", "--run-fill": "#e5dff2",
  "--scroll": "#cbb98d", "--scroll-hi": "#b39f6c",
  "--accent-veil": "rgba(151, 89, 19, 0.20)",
  "--on-veil": "rgba(62, 104, 41, 0.20)",
  "--danger-edge": "rgba(179, 64, 42, 0.42)",
  "--scrim": "rgba(58, 46, 28, 0.34)",
  "--glass": "rgba(58, 46, 28, 0.06)",
  "--glass-soft": "rgba(58, 46, 28, 0.045)",
  "--tip-bg": "rgba(250, 243, 227, 0.98)",
  "--tip-shadow": "0 8px 22px rgba(58, 46, 28, 0.18)",
  "--shadow-md": "0 4px 14px rgba(58, 46, 28, 0.12)",
  "--shadow-lg": "0 18px 44px rgba(58, 46, 28, 0.18)",
  "--drop-veil": "rgba(241, 230, 207, 0.66)", "--drop-line": "#975913", "--drop-ink": "#3a2e1c",
};

const NORD = {
  "--bg": "#2e3440", "--bg-sunken": "#242933", "--bg-raised": "#3b4252",
  "--bg-hover": "#434c5e", "--bg-active": "#4c566a",
  "--bg-deep": "#262b35", "--bg-tint": "#2a303c", "--bg-lift": "#3b4252", "--bg-glow": "#434c5e",
  "--bg-palette-head": "#191f2a", "--bg-palette-group": "#202632", "--bg-palette-hover": "#333945", "--bg-palette-title": "#2a313d",
  "--line-palette-group": "#434c60",
  "--line": "#4c566a", "--line-strong": "#5e6779", "--line-mid": "#545d70",
  "--line-soft": "#6b7385", "--line-faint": "#767e8f",
  "--text": "#eceff4", "--text-dim": "#d8dee9", "--text-faint": "#a5b0c5", "--text-hi": "#ffffff",
  "--accent": "#88c0d0", "--accent-hi": "#a3d4e0", "--accent-lo": "#6ba7b8",
  "--on": "#a4bf8d", "--on-hi": "#b6cd9f", "--off": "#7b8395",
  "--danger": "#bf616a", "--danger-hi": "#d17a82",
  "--global": "#ebcb8b", "--global-hi": "#f0d9a5",
  "--run": "#b48ead", "--run-hi": "#c5a4bf",
  "--macro": "#86e2bb",
  "--accent-soft": "rgba(136, 192, 208, 0.16)",
  "--on-soft": "rgba(164, 191, 141, 0.16)",
  "--danger-soft": "rgba(191, 97, 106, 0.16)",
  "--global-soft": "rgba(235, 203, 139, 0.16)",
  "--run-soft": "rgba(180, 142, 173, 0.18)",
  "--ink-accent": "#0e2429", "--ink-on": "#16210f", "--ink-run": "#241a22",
  "--ink-danger": "#21090c", "--ink-global": "#2b2210",
  "--accent-line": "#5e93a3", "--accent-fill": "#33424a", "--accent-ink": "#cdeaf2",
  "--on-line": "#7d9c69", "--on-fill": "#35402f",
  "--danger-line": "#94525a", "--danger-line-hi": "#a8636b",
  "--danger-fill": "#452b2e", "--danger-fill-hi": "#352023", "--danger-ink": "#f0b8bc",
  "--run-line": "#8f7091", "--run-fill": "#40323f",
  "--scroll": "#4c566a", "--scroll-hi": "#5e6779",
  "--accent-veil": "rgba(136, 192, 208, 0.26)",
  "--on-veil": "rgba(164, 191, 141, 0.26)",
  "--danger-edge": "rgba(191, 97, 106, 0.48)",
  "--scrim": "rgba(20, 23, 29, 0.66)",
  "--glass": "rgba(236, 239, 244, 0.06)",
  "--glass-soft": "rgba(236, 239, 244, 0.04)",
  "--tip-bg": "rgba(59, 66, 82, 0.97)",
  "--tip-shadow": "0 8px 22px rgba(0, 0, 0, 0.45)",
  "--shadow-md": "0 4px 14px rgba(0, 0, 0, 0.45)",
  "--shadow-lg": "0 18px 44px rgba(0, 0, 0, 0.58)",
  "--drop-veil": "rgba(46, 52, 64, 0.66)", "--drop-line": "#88c0d0", "--drop-ink": "#eceff4",
};

const SOLARIZED = {
  "--bg": "#fdf6e3", "--bg-sunken": "#fffbf0", "--bg-raised": "#fffbf0",
  "--bg-hover": "#eee8d5", "--bg-active": "#e3dcc6",
  "--bg-deep": "#f5efdc", "--bg-tint": "#eee8d5", "--bg-lift": "#eee8d5", "--bg-glow": "#e3dcc6",
  "--bg-palette-head": "#f1ebd8", "--bg-palette-group": "#fbf5e2", "--bg-palette-hover": "#fffdf8", "--bg-palette-title": "#e6dcc0",
  "--line-palette-group": "#c6bda1",
  "--line": "#cfc8ab", "--line-strong": "#b5ab85", "--line-mid": "#c2b99a",
  "--line-soft": "#a89d76", "--line-faint": "#93a1a1",
  "--text": "#073642", "--text-dim": "#465a61", "--text-faint": "#5a6c6f", "--text-hi": "#002b36",
  "--accent": "#0074b8", "--accent-hi": "#006ba9", "--accent-lo": "#005689",
  "--on": "#45721d", "--on-hi": "#3b6811", "--off": "#919f9f",
  "--danger": "#d52a29", "--danger-hi": "#ca1a1e",
  "--global": "#8d6a00", "--global-hi": "#826100",
  "--run": "#6468ba", "--run-hi": "#5b5fb0",
  "--macro": "#005d34",
  "--accent-soft": "rgba(0, 116, 184, 0.12)",
  "--on-soft": "rgba(69, 114, 29, 0.12)",
  "--danger-soft": "rgba(213, 42, 41, 0.12)",
  "--global-soft": "rgba(141, 106, 0, 0.14)",
  "--run-soft": "rgba(100, 104, 186, 0.12)",
  "--ink-accent": "#fdf6e3", "--ink-on": "#fdf6e3", "--ink-run": "#fdf6e3",
  "--ink-danger": "#fdf6e3", "--ink-global": "#fdf6e3",
  "--accent-line": "#8fc0e8", "--accent-fill": "#dceaf5", "--accent-ink": "#164a6e",
  "--on-line": "#a3c97a", "--on-fill": "#e6f0d8",
  "--danger-line": "#eba6a4", "--danger-line-hi": "#e08582",
  "--danger-fill": "#fbe0df", "--danger-fill-hi": "#f6c9c7", "--danger-ink": "#7d1613",
  "--run-line": "#c3c5ea", "--run-fill": "#e6e6f6",
  "--scroll": "#ccc3a0", "--scroll-hi": "#b0a582",
  "--accent-veil": "rgba(0, 116, 184, 0.18)",
  "--on-veil": "rgba(69, 114, 29, 0.18)",
  "--danger-edge": "rgba(213, 42, 41, 0.40)",
  "--scrim": "rgba(7, 54, 66, 0.32)",
  "--glass": "rgba(7, 54, 66, 0.05)",
  "--glass-soft": "rgba(7, 54, 66, 0.04)",
  "--tip-bg": "rgba(255, 251, 240, 0.98)",
  "--tip-shadow": "0 8px 22px rgba(7, 54, 66, 0.16)",
  "--shadow-md": "0 4px 14px rgba(7, 54, 66, 0.10)",
  "--shadow-lg": "0 18px 44px rgba(7, 54, 66, 0.16)",
  "--drop-veil": "rgba(253, 246, 227, 0.66)", "--drop-line": "#0074b8", "--drop-ink": "#073642",
};

export const MODES = [
  { id: "midnight", tone: "dark" },
  { id: "dark", tone: "dark" },
  { id: "nord", tone: "dark" },
  { id: "monokai", tone: "dark" },
  { id: "solardark", tone: "dark" },
  { id: "dracula", tone: "dark" },
  { id: "forest", tone: "dark" },
  { id: "light", tone: "light" },
  { id: "sepia", tone: "light" },
  { id: "ragdoll", tone: "light" },
  { id: "solarized", tone: "light" },
  { id: "contrast", tone: "light" },
  { id: "custom", tone: "dark" },
];

export const known = (mode) => MODES.some((m) => m.id === mode);

const TONE_OF = Object.fromEntries(MODES.map((m) => [m.id, m.tone]));

const PRESETS = {
  dark: DARK,
  light: LIGHT,
  ragdoll: RAGDOLL,
  midnight: MIDNIGHT,
  sepia: SEPIA,
  nord: NORD,
  solarized: SOLARIZED,
};

export const CHANGED = "webgba:theme";

export const presetOf = (mode) => ({ ...(PRESETS[mode] ?? DARK) });

let liveFrame = 0;
let pendingLive = null;

export function apply(theme = {}) {
  if (liveFrame) {
    cancelAnimationFrame(liveFrame);
    liveFrame = 0;
    pendingLive = null;
  }

  const mode = theme.mode ?? "dark";
  const given = theme.colors ?? {};

  const base = presetOf(mode === "custom" ? (toneOf(given) === "light" ? "light" : "dark") : mode);
  const colors = mode === "custom" ? { ...base, ...given } : base;

  const root = document.documentElement.style;
  for (const key of KEYS) {
    if (colors[key]) root.setProperty(key, colors[key]);
  }

  document.documentElement.dataset.theme = mode;
  document.documentElement.dataset.tone =
    mode === "custom" ? toneOf(colors) : (TONE_OF[mode] ?? "dark");

  document.dispatchEvent(new CustomEvent(CHANGED, { detail: { mode } }));
}

export function applyLive(theme = {}) {
  pendingLive = theme;
  if (liveFrame) return;
  liveFrame = requestAnimationFrame(() => {
    liveFrame = 0;
    const next = pendingLive;
    pendingLive = null;
    apply(next);
  });
}

function oklchToLinear(L, C, H) {
  const rad = (H * Math.PI) / 180;
  const a = C * Math.cos(rad);
  const b = C * Math.sin(rad);

  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;

  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const inGamut = (rgb) => rgb.every((v) => v >= -1e-4 && v <= 1 + 1e-4);

function fitChroma(L, C, H) {
  if (inGamut(oklchToLinear(L, C, H))) return C;

  let lo = 0;
  let hi = C;
  for (let i = 0; i < 16; i += 1) {
    const mid = (lo + hi) / 2;
    if (inGamut(oklchToLinear(L, mid, H))) lo = mid;
    else hi = mid;
  }
  return lo;
}

function oklch(L, C, H) {
  const light = Math.min(0.995, Math.max(0.02, L));
  const rgb = oklchToLinear(light, fitChroma(light, Math.max(0, C), H), H);

  const byte = (v) => {
    const encoded = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
    return Math.round(Math.min(1, Math.max(0, encoded)) * 255);
  };

  return `#${rgb.map((v) => byte(v).toString(16).padStart(2, "0")).join("")}`;
}

const channels = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

const rgba = (hex, alpha) => `rgba(${channels(hex).join(", ")}, ${alpha})`;

function luminance(hex) {
  const [r, g, b] = channels(hex).map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function lightness(hex) {
  const [r, g, b] = channels(hex).map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
}

export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function flatten(value, base) {
  if (typeof value !== "string" || !value.startsWith("rgba")) return value;
  const [r, g, b, a] = value
    .slice(value.indexOf("(") + 1, value.lastIndexOf(")"))
    .split(",")
    .map(Number);
  const under = channels(base);
  const byte = (x, i) => Math.round(x * a + under[i] * (1 - a)).toString(16).padStart(2, "0");
  return "#" + [r, g, b].map(byte).join("");
}

export function toneOf(colors) {
  const bg = colors?.["--bg"] ?? "";
  if (!/^#[0-9a-f]{6}$/i.test(bg.trim())) return "dark";
  return luminance(bg.trim()) >= 0.2 ? "light" : "dark";
}

const MEANING_HUE = {
  danger: 25,
  global: 80,
  on: 155,
};

const arc = (a, b) => {
  const d = Math.abs((((a - b) % 360) + 360) % 360);
  return Math.min(d, 360 - d);
};

const usableAccent = (h) => Object.values(MEANING_HUE).every((m) => arc(h, m) >= 40);

const ACCENT_HUES = (() => {
  const out = [];
  for (let h = 0; h < 360; h += 1) if (usableAccent(h)) out.push(h);
  return out;
})();

function nearestAccent(h) {
  let best = ACCENT_HUES[0];
  let near = 360;
  for (const a of ACCENT_HUES) {
    const d = arc(a, h);
    if (d < near) {
      near = d;
      best = a;
    }
  }
  return best;
}

function accentFor(hue, rand) {
  return usableAccent(hue) ? hue : ACCENT_HUES[Math.floor(rand() * ACCENT_HUES.length)] + rand();
}

function farthestHue(taken) {
  const sorted = taken.map((h) => ((h % 360) + 360) % 360).sort((a, b) => a - b);

  let best = sorted[0];
  let widest = -1;
  for (let i = 0; i < sorted.length; i += 1) {
    const from = sorted[i];
    const to = i + 1 < sorted.length ? sorted[i + 1] : sorted[0] + 360;
    if (to - from > widest) {
      widest = to - from;
      best = (from + (to - from) / 2) % 360;
    }
  }
  return best;
}

export const TONES = [
  { id: "any" },
  { id: "light" },
  { id: "dark" },
];

export const CASTS = [
  { id: "any", hue: null, dot: null },
  { id: "gray", hue: null, gray: true, dot: oklch(0.62, 0, 0) },
  { id: "red", hue: 25, dot: oklch(0.62, 0.15, 25) },
  { id: "orange", hue: 55, dot: oklch(0.62, 0.15, 55) },
  { id: "yellow", hue: 95, dot: oklch(0.62, 0.15, 95) },
  { id: "green", hue: 145, dot: oklch(0.62, 0.15, 145) },
  { id: "teal", hue: 195, dot: oklch(0.62, 0.15, 195) },
  { id: "blue", hue: 255, dot: oklch(0.62, 0.15, 255) },
  { id: "violet", hue: 300, dot: oklch(0.62, 0.15, 300) },
  { id: "pink", hue: 345, dot: oklch(0.62, 0.15, 345) },
];

const castOf = (id) => CASTS.find((c) => c.id === id) ?? CASTS[0];

const LADDER = {
  "--bg": [0, 1.0],
  "--bg-sunken": [-0.03, 0.66],
  "--bg-deep": [-0.009, 0.88],
  "--bg-tint": [0.02, 1.21],
  "--bg-raised": [0.058, 1.3],
  "--bg-lift": [0.089, 1.59],
  "--bg-glow": [0.11, 1.68],
  "--bg-hover": [0.113, 1.56],
  "--bg-active": [0.16, 1.97],
  "--line": [0.159, 1.82],
  "--line-mid": [0.192, 2.03],
  "--line-strong": [0.227, 2.13],
  "--line-soft": [0.259, 1.93],
  "--line-faint": [0.278, 1.73],
  "--scroll": [0.183, 1.94],
  "--scroll-hi": [0.251, 2.16],
  "--off": [0.326, 1.4],
};

const LIGHT_LADDER = {
  "--bg": [0, 1.0],
  "--bg-sunken": [0.031, 0.58],
  "--bg-raised": [0.031, 0.58],
  "--bg-deep": [-0.02, 1.16],
  "--bg-tint": [-0.046, 1.47],
  "--bg-lift": [-0.033, 1.45],
  "--bg-hover": [-0.033, 1.45],
  "--bg-glow": [-0.075, 1.78],
  "--bg-active": [-0.075, 1.78],
  "--line": [-0.101, 1.72],
  "--line-mid": [-0.151, 1.93],
  "--line-strong": [-0.202, 2.13],
  "--line-soft": [-0.26, 2.12],
  "--line-faint": [-0.295, 2.05],
  "--scroll": [-0.144, 1.9],
  "--scroll-hi": [-0.231, 2.21],
  "--off": [-0.275, 2.11],
};

const LADDERS = { dark: LADDER, light: LIGHT_LADDER };

const LINES = ["--line", "--line-mid", "--line-strong", "--line-soft", "--line-faint", "--off"];

const TEXT_L = { dark: [0.945, 0.8, 0.63], light: [0.3, 0.46, 0.53] };

const FAMILY = {
  dark: {
    accent: [0.685, 0.165],
    on: [0.774, 0.164],
    danger: [0.691, 0.199],
    global: [0.806, 0.147],
    run: [0.686, 0.188],
  },
  light: {
    accent: [0.545, 0.15],
    on: [0.535, 0.115],
    danger: [0.55, 0.17],
    global: [0.6, 0.12],
    run: [0.545, 0.14],
  },
};

const SHADES = {
  "--accent-line": { hue: "accent", dark: [0.473, 0.113], light: [0.78, 0.085] },
  "--accent-fill": { hue: "accent", dark: [0.348, 0.093], light: [0.925, 0.028] },
  "--accent-ink": { hue: "accent", dark: [0.896, 0.05], light: [0.4, 0.1] },
  "--on-line": { hue: "on", dark: [0.522, 0.094], light: [0.81, 0.086] },
  "--on-fill": { hue: "on", dark: [0.266, 0.034], light: [0.944, 0.028] },
  "--danger-line": { hue: "danger", dark: [0.459, 0.109], light: [0.794, 0.078] },
  "--danger-line-hi": { hue: "danger", dark: [0.554, 0.133], light: [0.693, 0.118] },
  "--danger-fill": { hue: "danger", dark: [0.277, 0.046], light: [0.93, 0.028] },
  "--danger-fill-hi": { hue: "danger", dark: [0.232, 0.036], light: [0.881, 0.048] },
  "--danger-ink": { hue: "danger", dark: [0.817, 0.103], light: [0.41, 0.12] },
  "--run-line": { hue: "run", dark: [0.282, 0.065], light: [0.905, 0.042] },
  "--run-fill": { hue: "run", dark: [0.32, 0.082], light: [0.939, 0.028] },
};

const MAX_C = {
  dark: { surface: 0.042, line: 0.09, accent: 0.21 },
  light: { surface: 0.034, line: 0.075, accent: 0.19 },
};

const ALPHA = {
  dark: { soft: 0.14, softRun: 0.16, veil: 0.24, edge: 0.45, focus: 0.28 },
  light: { soft: 0.12, softRun: 0.14, veil: 0.18, edge: 0.4, focus: 0.22 },
};

const NEEDS = [
  ["--text", "--bg", 7],
  ["--text", "--bg-sunken", 7],
  ["--text", "--bg-raised", 7],
  ["--text-dim", "--bg", 4.5],
  ["--text-dim", "--bg-hover", 4.5],
  ["--text-dim", "--bg-tint", 4.5],
  ["--text-faint", "--bg", 4.5],
  ["--text-faint", "--bg-raised", 4.5],
  ["--text-faint", "--bg-sunken", 4.5],
  ["--text", "--bg-palette-head", 4.5],
  ["--text-dim", "--bg-palette-head", 4.5],
  ["--text-faint", "--bg-palette-head", 4.5],
  ["--text-dim", "--bg-palette-title", 4.5],
  ["--text-dim", "--bg-palette-group", 4.5],
  ["--text-faint", "--bg-palette-group", 4.5],
  ["--accent", "--bg-palette-hover", 4.5],
  ["--text-dim", "--bg-palette-hover", 4.5],
  ["--text-faint", "--bg-palette-hover", 3],
  ["--line-palette-group", "--bg-tint", 1.45],
  ["--line-palette-group", "--bg-palette-group", 1.45],
  ["--bg-palette-group", "--bg-tint", 0.025, "L"],
  ["--bg-palette-head", "--bg-palette-group", 0.025, "L"],
  ["--bg-palette-hover", "--bg-palette-group", 0.02, "L"],
  ["--bg-palette-hover", "--bg-palette-head", 0.04, "L"],
  ["--bg-palette-title", "--bg-palette-head", 0.02, "L"],
  ["--line", "--bg", 1.45],
  ["--line-strong", "--bg", 1.9],
  ["--off", "--bg", 2.5],
  ["--off", "--bg-raised", 2.5],
  ["--accent", "--bg", 4.5],
  ["--accent", "--bg-raised", 4.5],
  ["--on", "--bg", 3],
  ["--on", "--on-soft", 4.5],
  ["--on", "--on-fill", 4.5],
  ["--danger", "--bg", 3],
  ["--global", "--bg", 4.5],
  ["--global", "--bg-raised", 4.5],
  ["--global", "--bg-sunken", 4.5],
  ["--macro", "--bg", 4.5],
  ["--macro", "--bg-hover", 4.5],
  ["--macro", "--bg-active", 4.5],
  ["--macro", "--accent-soft", 4.5],
  ["--run", "--bg", 3],
  ["--ink-accent", "--accent", 4.5],
  ["--ink-accent", "--accent-hi", 4.5],
  ["--ink-accent", "--accent-lo", 4.5],
  ["--ink-on", "--on", 4.5],
  ["--ink-on", "--on-hi", 4.5],
  ["--ink-danger", "--danger", 4.5],
  ["--ink-danger", "--danger-hi", 4.5],
  ["--ink-global", "--global", 4.5],
  ["--ink-global", "--global-hi", 4.5],
  ["--ink-run", "--run", 4.5],
  ["--ink-run", "--run-hi", 4.5],
  ["--accent-ink", "--accent-fill", 4.5],
  ["--danger-ink", "--danger-fill", 4.5],
  ["--danger-ink", "--danger-fill-hi", 4.5],
  ["--drop-ink", "--bg-raised", 4.5],
  ["--drop-line", "--drop-veil", 3],
  ["--drop-line", "--bg-sunken", 3],
];

export function audit(colors) {
  const bad = [];
  for (const [a, b, need, kind] of NEEDS) {
    const x = flatten(colors[a], colors["--bg"]);
    const y = flatten(colors[b], colors["--bg"]);
    const got = kind === "L" ? Math.abs(lightness(x) - lightness(y)) : contrast(x, y);
    if (!Number.isFinite(got) || got + 1e-9 < need) {
      bad.push({ pair: `${a} ↔ ${b}${kind === "L" ? " ΔL" : ""}`, need, got: Number(got.toFixed(kind === "L" ? 3 : 2)) });
    }
  }
  return bad;
}

function push(L, C, hue, ref, need, dir, fade = 1) {
  let hex = oklch(L, C, hue);
  for (let i = 0; i < 30 && contrast(hex, ref) < need; i += 1) {
    L = Math.min(0.995, Math.max(0.02, L + dir * 0.008));
    C *= fade;
    hex = oklch(L, C, hue);
  }
  return { hex, L, C };
}

function draw(rand, recipe = {}) {
  const tone = recipe.tone === "light" || recipe.tone === "dark" ? recipe.tone : rand() < 0.5 ? "light" : "dark";
  const cast = castOf(recipe.cast);

  const baseHue = cast.hue == null ? rand() * 360 : (cast.hue + (rand() - 0.5) * 14 + 360) % 360;

  return {
    tone,
    baseHue,
    accentHue: accentFor(baseHue, rand),
    bgL: tone === "light" ? 0.92 + rand() * 0.058 : 0.14 + rand() * 0.085,
    tint: cast.gray ? 0 : 0.3 + rand() * 1.05,
    vivid: 0.82 + rand() * 0.33,
    step: 0.88 + rand() * 0.28,
  };
}

function build({ tone, baseHue, accentHue, bgL, tint, vivid, step }) {
  const light = tone === "light";
  const dir = light ? -1 : 1;
  const ladder = LADDERS[tone];
  const family = FAMILY[tone];
  const cap = MAX_C[tone];
  const alpha = ALPHA[tone];

  const runHue = farthestHue([accentHue, ...Object.values(MEANING_HUE)]);
  const hueOf = { accent: accentHue, run: runHue, ...MEANING_HUE };

  const out = {};
  const baseC = (light ? 0.024 : 0.03) * tint;

  const rung = (key, lift = 0) => {
    const [dl, cx] = ladder[key];
    const limit = key.startsWith("--bg") ? cap.surface : cap.line;
    return oklch(bgL + dl * step + lift, Math.min(limit, baseC * cx), baseHue);
  };
  for (const key of Object.keys(ladder)) out[key] = rung(key);

  const tintL = bgL + ladder["--bg-tint"][0] * step;
  const groupL = light ? 0.968 : tintL - 0.04;
  const paletteC = Math.min(cap.surface, baseC * 1.2);
  out["--bg-palette-group"] = oklch(groupL, paletteC, baseHue);
  out["--bg-palette-head"] = light ? oklch(0.995, Math.min(0.01, baseC), baseHue) : oklch(groupL - 0.03, paletteC, baseHue);
  out["--bg-palette-hover"] = oklch(light ? 0.945 : groupL + 0.075, paletteC, baseHue);
  out["--bg-palette-title"] = oklch(light ? 0.968 : groupL + 0.02, paletteC, baseHue);

  const hardestOf = (keys) =>
    keys.map((k) => out[k]).reduce((a, b) => (luminance(b) * dir > luminance(a) * dir ? b : a));

  out["--line-palette-group"] = push(
    tintL + dir * 0.1,
    Math.min(cap.line, baseC * 1.8),
    baseHue,
    hardestOf(["--bg-tint", "--bg-palette-group"]),
    1.5,
    dir,
  ).hex;

  const hardest = hardestOf(["--bg", "--bg-sunken", "--bg-raised"]);

  const text = push(TEXT_L[tone][0], Math.min(0.014, 0.01 * tint), baseHue, hardest, 7, dir, 0.88);
  out["--text"] = text.hex;
  out["--text-hi"] = oklch(text.L + dir * 0.025, text.C * 0.6, baseHue);
  out["--text-dim"] = push(
    TEXT_L[tone][1],
    Math.min(0.038, 0.028 * tint),
    baseHue,
    hardestOf(["--bg", "--bg-hover", "--bg-tint", "--bg-palette-head", "--bg-palette-hover", "--bg-palette-title"]),
    4.5,
    dir,
  ).hex;
  out["--text-faint"] = push(
    TEXT_L[tone][2],
    Math.min(0.05, 0.04 * tint),
    baseHue,
    hardestOf(["--bg", "--bg-sunken", "--bg-raised", "--bg-palette-group", "--bg-palette-head"]),
    4.5,
    dir,
  ).hex;

  let lift = 0;
  for (let i = 0; i < 40; i += 1) {
    const low =
      contrast(out["--line"], out["--bg"]) < 1.45 ||
      contrast(out["--line-strong"], out["--bg"]) < 1.9 ||
      contrast(out["--off"], out["--bg"]) < 2.5;
    if (!low) break;
    lift += dir * 0.008;
    for (const key of LINES) out[key] = rung(key, lift);
  }

  const paperInk = light ? oklch(0.985, Math.min(0.01, baseC), baseHue) : null;

  for (const [key, spec] of Object.entries(SHADES)) {
    const [L, C] = spec[tone];
    out[key] = oklch(L, key.endsWith("-ink") ? C : C * vivid, hueOf[spec.hue]);
  }

  const TEXT_LIKE = {
    accent: hardestOf(["--bg", "--bg-raised", "--bg-palette-hover"]),
    global: hardestOf(["--bg", "--bg-raised", "--bg-sunken"]),
  };

  let onFace = null;
  for (const [name, [famL, famC]] of Object.entries(family)) {
    const hue = hueOf[name];
    const chroma = Math.min(cap.accent, famC * vivid);

    const facesOf = (L) => {
      const list = [oklch(L, chroma, hue), oklch(L + dir * 0.052, chroma, hue)];
      if (name === "accent") list.push(oklch(L - dir * 0.052, chroma, hue));
      return list;
    };

    let L = famL;
    let faces = facesOf(L);
    for (let i = 0; i < 32; i += 1) {
      const okBg = TEXT_LIKE[name]
        ? contrast(faces[0], TEXT_LIKE[name]) >= 4.5
        : contrast(faces[0], out["--bg"]) >= 3;
      const okOn =
        name !== "on" ||
        (contrast(faces[0], flatten(rgba(faces[0], alpha.soft), out["--bg"])) >= 4.5 &&
          contrast(faces[0], out["--on-fill"]) >= 4.5);
      const okInk = !light || faces.every((f) => contrast(paperInk, f) >= 4.5);
      if (okBg && okOn && okInk) break;
      L += dir * 0.012;
      faces = facesOf(L);
    }

    if (name === "on") onFace = { L, C: chroma };

    out[`--${name}`] = faces[0];
    out[`--${name}-hi`] = faces[1];
    if (name === "accent") out["--accent-lo"] = faces[2];

    if (light) {
      out[`--ink-${name}`] = paperInk;
    } else {
      let inkL = 0.19;
      let ink = oklch(inkL, 0.045, hue);
      for (let i = 0; i < 18 && faces.some((f) => contrast(ink, f) < 4.5); i += 1) {
        inkL = Math.max(0.02, inkL - 0.01);
        ink = oklch(inkL, 0.045, hue);
      }
      out[`--ink-${name}`] = ink;
    }

    out[`--${name}-soft`] = rgba(out[`--${name}`], name === "run" ? alpha.softRun : alpha.soft);
  }

  const macroHue = arc(accentHue, MEANING_HUE.on + 16) >= 40 ? MEANING_HUE.on + 16 : MEANING_HUE.on - 25;
  const macroSeat = [out["--bg"], out["--bg-hover"], out["--bg-active"], flatten(out["--accent-soft"], out["--bg"])].reduce(
    (a, b) => (luminance(b) * dir > luminance(a) * dir ? b : a),
  );
  const macroC = Math.min(cap.accent, onFace.C);
  const deep = oklch(onFace.L - dir * 0.1, macroC, macroHue);
  out["--macro"] =
    contrast(deep, macroSeat) >= 4.5 ? deep : push(onFace.L + dir * 0.1, macroC, macroHue, macroSeat, 4.5, dir).hex;

  out["--accent-veil"] = rgba(out["--accent"], alpha.veil);
  out["--on-veil"] = rgba(out["--on"], alpha.veil);
  out["--danger-edge"] = rgba(out["--danger"], alpha.edge);
  out["--tip-bg"] = rgba(out["--bg-raised"], 0.97);
  out["--drop-veil"] = rgba(out["--bg"], 0.66);
  out["--drop-line"] = out["--accent"];
  out["--drop-ink"] = out["--text"];

  if (light) {
    out["--scrim"] = rgba(out["--text"], 0.34);
    out["--glass"] = rgba(out["--text"], 0.05);
    out["--glass-soft"] = rgba(out["--text"], 0.04);
    out["--tip-shadow"] = `0 8px 22px ${rgba(out["--text"], 0.16)}`;
    out["--shadow-md"] = `0 4px 14px ${rgba(out["--text"], 0.1)}`;
    out["--shadow-lg"] = `0 18px 44px ${rgba(out["--text"], 0.16)}`;
  } else {
    out["--scrim"] = rgba(oklch(Math.max(0.05, bgL - 0.08), baseC * 0.8, baseHue), 0.62);
    out["--glass"] = "rgba(255, 255, 255, 0.06)";
    out["--glass-soft"] = "rgba(255, 255, 255, 0.04)";
    out["--tip-shadow"] = "0 8px 22px rgba(0, 0, 0, 0.45)";
    out["--shadow-md"] = "0 4px 14px rgba(0, 0, 0, 0.45)";
    out["--shadow-lg"] = "0 18px 44px rgba(0, 0, 0, 0.6)";
  }

  return out;
}

function fallback(recipe = {}) {
  const tone = recipe.tone === "light" ? "light" : "dark";
  const cast = castOf(recipe.cast);
  const baseHue = cast.hue ?? 250;

  return {
    tone,
    baseHue,
    accentHue: nearestAccent(baseHue),
    bgL: tone === "light" ? 0.95 : 0.165,
    tint: cast.gray ? 0 : 0.5,
    vivid: 0.85,
    step: 1,
  };
}

export function randomColors(rand = Math.random, recipe = {}) {
  for (let tries = 0; tries < 8; tries += 1) {
    const colors = build(draw(rand, recipe));
    if (audit(colors).length === 0) return colors;
  }
  return build(fallback(recipe));
}

function toOklch(hex) {
  const [r, g, b] = channels(hex).map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    C: Math.hypot(A, B),
    H: ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360,
  };
}

function inkFor(faces, hue) {
  let L = 0.19;
  let ink = oklch(L, 0.045, hue);
  for (let i = 0; i < 18 && faces.some((f) => contrast(ink, f) < 4.5); i += 1) {
    L = Math.max(0.02, L - 0.01);
    ink = oklch(L, 0.045, hue);
  }
  return ink;
}

function seeded({ tone, raised, sunken, hover, accent, extra = {} }) {
  const light = tone === "light";
  const ladder = LADDERS[tone];
  const base = toOklch(raised);
  const acc = toOklch(accent);
  const gray = base.C < 0.004;
  const perC = (light ? 0.024 : 0.03) * ladder["--bg-raised"][1];

  const colors = build({
    tone,
    baseHue: base.H,
    accentHue: acc.C < 0.004 ? base.H : acc.H,
    bgL: base.L - ladder["--bg-raised"][0],
    tint: gray ? 0 : Math.min(1.6, base.C / perC),
    vivid: 1,
    step: 1,
  });

  const keep = (patch) => {
    const next = { ...colors, ...patch };
    if (audit(next).length <= audit(colors).length) Object.assign(colors, patch);
  };

  keep({ "--bg-raised": raised, "--bg-sunken": sunken, "--bg-hover": hover });

  const dir = light ? -1 : 1;
  const hi = oklch(acc.L + dir * 0.052, acc.C, acc.H);
  const lo = oklch(acc.L - dir * 0.052, acc.C, acc.H);
  keep({
    "--accent": accent,
    "--accent-hi": hi,
    "--accent-lo": lo,
    "--accent-soft": rgba(accent, ALPHA[tone].soft),
    "--accent-veil": rgba(accent, ALPHA[tone].veil),
    "--drop-line": accent,
    ...(light ? {} : { "--ink-accent": inkFor([accent, hi, lo], acc.H) }),
  });

  keep(extra);
  return colors;
}

const EXTRA_PRESETS = {
  monokai: { tone: "dark", raised: "#2d2a2e", sunken: "#221f22", hover: "#3a353b", accent: "#78dce8" },
  solardark: { tone: "dark", raised: "#122430", sunken: "#06141d", hover: "#1b3644", accent: "#2aa198" },
  dracula: { tone: "dark", raised: "#241b2f", sunken: "#17111f", hover: "#33264a", accent: "#ff79c6" },
  forest: { tone: "dark", raised: "#122017", sunken: "#08120c", hover: "#1c3122", accent: "#7ee787" },
  contrast: {
    tone: "light",
    raised: "#ffffff",
    sunken: "#ffffff",
    hover: "#e6e6e6",
    accent: "#000000",
    extra: {
      "--bg": "#ffffff",
      "--text": "#000000",
      "--text-hi": "#000000",
      "--text-dim": "#1f1f1f",
      "--text-faint": "#3d3d3d",
      "--line": "#8c8c8c",
      "--line-mid": "#6e6e6e",
      "--line-strong": "#4d4d4d",
      "--line-soft": "#404040",
      "--line-faint": "#333333",
      "--accent-line": "#000000",
      "--accent-fill": "#e6e6e6",
      "--accent-ink": "#000000",
    },
  },
};

for (const [id, seed] of Object.entries(EXTRA_PRESETS)) PRESETS[id] = seeded(seed);
