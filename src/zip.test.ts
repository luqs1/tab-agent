import { test, expect } from "bun:test";
import { zipWithMode } from "./zip";

// Independent CRC-32 so a regression in field placement (not just the CRC math)
// is caught: if the crc lands at the wrong offset, this comparison fails.
function crc32(buf: Uint8Array): number {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

test("zipWithMode lays out a valid single stored entry", async () => {
  const name = "setup.command";
  const body = "echo hi\n";
  const bytes = new Uint8Array(await zipWithMode(name, body, 0o100755).arrayBuffer());
  const dv = new DataView(bytes.buffer);
  const data = new TextEncoder().encode(body);

  // local file header
  expect(dv.getUint32(0, true)).toBe(0x04034b50);
  expect(dv.getUint32(14, true)).toBe(crc32(data)); // crc at the right offset
  expect(dv.getUint32(22, true)).toBe(data.length); // uncompressed size
  const nameLen = dv.getUint16(26, true);
  expect(new TextDecoder().decode(bytes.subarray(30, 30 + nameLen))).toBe(name);

  // end of central directory (fixed 22 bytes, no comment) → find the central dir
  const eocd = bytes.length - 22;
  expect(dv.getUint32(eocd, true)).toBe(0x06054b50);
  expect(dv.getUint16(eocd + 10, true)).toBe(1); // one entry
  const cdOffset = dv.getUint32(eocd + 16, true);

  // central directory header carries the unix mode in external attrs
  expect(dv.getUint32(cdOffset, true)).toBe(0x02014b50);
  expect(dv.getUint32(cdOffset + 16, true)).toBe(crc32(data)); // crc matches local
  expect(dv.getUint32(cdOffset + 38, true)).toBe((0o100755 << 16) >>> 0);
});

test("zipWithMode honours a custom mode", async () => {
  const bytes = new Uint8Array(await zipWithMode("x", "y", 0o100644).arrayBuffer());
  const dv = new DataView(bytes.buffer);
  const cdOffset = dv.getUint32(bytes.length - 22 + 16, true);
  expect(dv.getUint32(cdOffset + 38, true)).toBe((0o100644 << 16) >>> 0);
});
