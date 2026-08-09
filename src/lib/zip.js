// Minimal ZIP writer using the STORE method (no compression).

import { TX } from "../tx.js";

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function dosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  return {
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
  };
}

// Bit 11 declares the filename as UTF-8 so non-ASCII names survive.
const FLAG_UTF8 = 0x0800;

function writer(size) {
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  let at = 0;
  return {
    bytes,
    u16(v) { view.setUint16(at, v, true); at += 2; },
    u32(v) { view.setUint32(at, v >>> 0, true); at += 4; },
    raw(src) { bytes.set(src, at); at += src.length; },
  };
}

function createZip(entries, when) {
  const utf8 = new TextEncoder();
  const stamp = dosDateTime(when || new Date());

  const files = entries.map(e => {
    const name = utf8.encode(e.name);
    return { name, data: e.bytes, crc: crc32(e.bytes) };
  });

  const LOCAL = 30;
  const CENTRAL = 46;
  const EOCD = 22;

  const localSize = files.reduce((n, f) => n + LOCAL + f.name.length + f.data.length, 0);
  const centralSize = files.reduce((n, f) => n + CENTRAL + f.name.length, 0);

  const w = writer(localSize + centralSize + EOCD);
  const offsets = [];
  let offset = 0;

  for (const f of files) {
    offsets.push(offset);
    w.u32(0x04034B50);
    w.u16(20);
    w.u16(FLAG_UTF8);
    w.u16(0);
    w.u16(stamp.time);
    w.u16(stamp.date);
    w.u32(f.crc);
    w.u32(f.data.length);
    w.u32(f.data.length);
    w.u16(f.name.length);
    w.u16(0);
    w.raw(f.name);
    w.raw(f.data);
    offset += LOCAL + f.name.length + f.data.length;
  }

  files.forEach((f, i) => {
    w.u32(0x02014B50);
    w.u16(20);
    w.u16(20);
    w.u16(FLAG_UTF8);
    w.u16(0);
    w.u16(stamp.time);
    w.u16(stamp.date);
    w.u32(f.crc);
    w.u32(f.data.length);
    w.u32(f.data.length);
    w.u16(f.name.length);
    w.u16(0);
    w.u16(0);
    w.u16(0);
    w.u16(0);
    w.u32(0);
    w.u32(offsets[i]);
    w.raw(f.name);
  });

  w.u32(0x06054B50);
  w.u16(0);
  w.u16(0);
  w.u16(files.length);
  w.u16(files.length);
  w.u32(centralSize);
  w.u32(localSize);
  w.u16(0);

  return new Blob([w.bytes], { type: "application/zip" });
}

TX.zip = { createZip, crc32 };

