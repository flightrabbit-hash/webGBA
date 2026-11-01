// 시험용 ZIP 만들기(롬이 든 ZIP 은 저장소에 두지 않고 시험이 돌 때 만든다). node 기본 모듈만.
//   makeZip([{ name, data, method?, flags?, raw?, crc?, size? }], { zip64? }) → Buffer
//   method 0 = 저장, 8 = Deflate(기본). 그 밖의 값은 data 를 그대로 넣고 방식 번호만 적는다(지원하지 않는 방식 시험).
//   flags 의 bit 0 = 암호(내용은 그대로). raw·crc·size 로 압축 바이트·CRC·풀린 크기를 덮어쓴다(망가진 ZIP 시험).
//   zip64 면 중앙 디렉토리의 크기·자리를 0xFFFFFFFF 로 두고 ZIP64 추가 칸·ZIP64 끝 레코드로 적는다.
import zlib from "zlib";

const u16 = (n) => {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n);
  return b;
};
const u32 = (n) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0);
  return b;
};
const u64 = (n) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n));
  return b;
};

export function makeZip(files, { zip64 = false } = {}) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, "utf8");
    const data = Buffer.from(file.data ?? []);
    const method = file.method ?? 8;
    const body = file.raw ? Buffer.from(file.raw) : method === 8 ? zlib.deflateRawSync(data, { level: 9 }) : data;
    const flags = (file.flags ?? 0) | (/[^\x00-\x7f]/.test(file.name) ? 0x800 : 0);
    const crc = file.crc ?? zlib.crc32(data);
    const size = file.size ?? data.length;
    const local = Buffer.concat([u32(0x04034b50), u16(20), u16(flags), u16(method), u16(0), u16(0x21), u32(crc), u32(body.length), u32(size), u16(name.length), u16(0), name]);
    const extra = zip64 ? Buffer.concat([u16(1), u16(24), u64(size), u64(body.length), u64(offset)]) : Buffer.alloc(0);
    const wide = (n) => (zip64 ? 0xffffffff : n);
    central.push(Buffer.concat([u32(0x02014b50), u16(zip64 ? 45 : 20), u16(zip64 ? 45 : 20), u16(flags), u16(method), u16(0), u16(0x21), u32(crc), u32(wide(body.length)), u32(wide(size)), u16(name.length), u16(extra.length), u16(0), u16(0), u16(0), u32(0), u32(wide(offset)), name, extra]));
    parts.push(local, body);
    offset += local.length + body.length;
  }
  const dir = Buffer.concat(central);
  const tail = [];
  if (zip64) {
    const at = offset + dir.length;
    tail.push(Buffer.concat([u32(0x06064b50), u64(44), u16(45), u16(45), u32(0), u32(0), u64(files.length), u64(files.length), u64(dir.length), u64(offset)]));
    tail.push(Buffer.concat([u32(0x07064b50), u32(0), u64(at), u32(1)]));
  }
  const count = zip64 ? 0xffff : files.length;
  tail.push(Buffer.concat([u32(0x06054b50), u16(0), u16(0), u16(count), u16(count), u32(zip64 ? 0xffffffff : dir.length), u32(zip64 ? 0xffffffff : offset), u16(0)]));
  return Buffer.concat([...parts, dir, ...tail]);
}
