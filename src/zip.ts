// Minimal, dependency-free ZIP writer for a single *executable* file.
//
// Why this exists: the browser can't set a file's executable bit, and a bare
// downloaded .command therefore won't run on double-click. But a ZIP entry stores
// the Unix mode, and macOS's unarchiver (ditto) restores it. So we ship the
// installer inside a zip with mode 0o100755 — double-click the zip, and the
// extracted .command is already executable. Verified end-to-end via `ditto`.
//
// Single stored (uncompressed) entry — enough for a small shell script, and it
// keeps the byte layout simple and exactly matches what was tested.

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Build a .zip (as a Blob) containing one file with the given Unix mode. */
export function zipWithMode(name: string, text: string, mode = 0o100755): Blob {
  const enc = new TextEncoder();
  const nameB = enc.encode(name);
  const data = enc.encode(text);
  const crc = crc32(data);
  const parts: Uint8Array[] = [];
  const u16 = (v: number) => { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, v, true); parts.push(b); };
  const u32 = (v: number) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v >>> 0, true); parts.push(b); };
  const raw = (b: Uint8Array) => parts.push(b);
  const len = () => parts.reduce((a, c) => a + c.length, 0);

  // local file header
  u32(0x04034b50); u16(20); u16(0); u16(0); u16(0); u16(0);
  u32(crc); u32(data.length); u32(data.length); u16(nameB.length); u16(0);
  raw(nameB); raw(data);
  const cdOffset = len();

  // central directory header — version-made-by high byte 3 = Unix; external attrs = mode<<16
  u32(0x02014b50); u16((3 << 8) | 20); u16(20); u16(0); u16(0); u16(0); u16(0);
  u32(crc); u32(data.length); u32(data.length); u16(nameB.length); u16(0); u16(0); u16(0); u16(0);
  u32((mode << 16) >>> 0); u32(0); raw(nameB);
  const cdSize = len() - cdOffset;

  // end of central directory
  u32(0x06054b50); u16(0); u16(0); u16(1); u16(1); u32(cdSize); u32(cdOffset); u16(0);

  // concatenate into one ArrayBuffer-backed array for the Blob
  const out = new Uint8Array(len());
  let o = 0;
  for (const c of parts) { out.set(c, o); o += c.length; }
  return new Blob([out.buffer], { type: "application/zip" });
}
