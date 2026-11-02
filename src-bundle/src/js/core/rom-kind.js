import { crc32 } from "./wgbp.js";

const GB_LOGO_CRC = 0x46195417;

export const GB_SCREEN = Object.freeze({ width: 160, height: 144, integer: false, aspect: Object.freeze([10, 9]), stretch: false });

const SYSTEM_CODE = { 1: "gb", 2: "gbc" };

function zeroRun(bytes, start, end) {
  for (let i = start; i < end; i++) if (bytes[i] !== 0) return false;
  return true;
}

export function romKind(bytes) {
  const b = bytes ?? new Uint8Array(0);
  const gba = b.length >= 0xc0 && b[3] === 0xea && (b[0xb2] === 0x96 || zeroRun(b, 4, 0xa0));
  if (gba || b.length < 0x150 || crc32(b, 0x104, 0x134) !== GB_LOGO_CRC) return { system: "gba", color: "" };
  const flag = b[0x143];
  return { system: "gb", color: flag & 0x80 ? (flag & 0x40 ? "only" : "dual") : "" };
}

export function systemKind(code, bytes) {
  const name = SYSTEM_CODE[code];
  if (!name) return { system: "gba", color: "" };
  if (name === "gb") return { system: "gb", color: "" };
  return { system: "gb", color: (bytes?.[0x143] & 0xc0) === 0xc0 ? "only" : "dual" };
}

export const romType = (kind) => (kind?.system !== "gb" ? "gba" : kind.color ? "gbc" : "gb");

export function kindKey(kind) {
  if (kind?.system !== "gb") return "";
  if (kind.color === "only") return "rom.gbcOnly";
  return kind.color === "dual" ? "rom.gbcDual" : "rom.gb";
}
