import { cartImages, cartModel } from "./cart.js";

export const APP_TITLE = "webGBA";
export const ART_SIZES = [96, 128, 192, 256, 384, 512];
export const APP_ART = Object.freeze([
  Object.freeze({ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }),
  Object.freeze({ src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" }),
]);
const ART_PARTS = ["label", "front"];

export const artScale = (width, height, size) => Math.min(Math.floor(size / width), Math.floor(size / height));

const blobOf = (canvas) => new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("toBlob"))), "image/png"));

const dataUrlOf = (blob) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

async function cartPicture(rom, read) {
  const model = cartModel(rom);
  for (const part of ART_PARTS) {
    if (!model.parts.includes(part)) continue;
    const images = await cartImages(rom, { ...model, parts: [part] }, read);
    if (images[part]) return { bitmap: images[part], color: model.color, part };
  }
  return null;
}

export async function gameArt(rom, read) {
  const picture = rom ? await cartPicture(rom, read) : null;
  if (!picture) return null;
  const { bitmap, color } = picture;
  const out = [];
  for (const size of ART_SIZES) {
    const scale = artScale(bitmap.width, bitmap.height, size);
    if (scale < 1) continue;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, size, size);
    const width = bitmap.width * scale;
    const height = bitmap.height * scale;
    ctx.drawImage(bitmap, Math.floor((size - width) / 2), Math.floor((size - height) / 2), width, height);
    out.push({ src: await dataUrlOf(await blobOf(canvas)), sizes: `${size}x${size}`, type: "image/png" });
  }
  return out.length ? { artwork: out, part: picture.part, scale: artScale(bitmap.width, bitmap.height, 512), color } : null;
}

const OFF = Object.freeze({ enabled: false, setGame: () => Promise.resolve(), sync() {} });

export function createMedia({ read, titleOf, play, pause, scope = globalThis }) {
  const session = scope.__TAURI__ ? null : scope.navigator?.mediaSession ?? null;
  if (!session) return OFF;
  const Metadata = scope.MediaMetadata ?? null;
  const now = { rom: null, title: APP_TITLE, artist: "", artwork: APP_ART, playback: "", token: 0 };
  const apply = () => {
    if (!Metadata) return;
    try {
      session.metadata = new Metadata({ title: now.title, artist: now.artist, album: "", artwork: now.artwork });
    } catch {}
  };
  for (const [action, run] of [["play", play], ["pause", pause]]) {
    try {
      session.setActionHandler(action, () => run());
    } catch {}
  }
  apply();

  async function setGame(rom) {
    const token = ++now.token;
    if (!rom) {
      Object.assign(now, { rom: null, title: APP_TITLE, artist: "", artwork: APP_ART });
      apply();
      return;
    }
    const art = await gameArt(rom, (part) => read(rom, part)).catch(() => null);
    if (token !== now.token) return;
    Object.assign(now, { rom, title: titleOf(rom) || APP_TITLE, artist: APP_TITLE, artwork: art?.artwork ?? APP_ART });
    apply();
  }

  function sync(playback) {
    if (now.rom) {
      const title = titleOf(now.rom) || APP_TITLE;
      if (title !== now.title) {
        now.title = title;
        apply();
      }
    }
    if (playback === now.playback) return;
    now.playback = playback;
    try {
      session.playbackState = playback;
    } catch {}
  }

  return { enabled: true, setGame, sync };
}
