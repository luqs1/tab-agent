// Stub for node:zlib in the browser. just-bash imports these for its
// gzip/gunzip/zcat commands, which it already documents as non-functional in
// browsers. We provide throwing stubs so the bundle builds; the rest of the
// shell works fine. Wire up `fflate` here later if you actually need gzip.
const nope = (): never => {
  throw new Error("gzip/gunzip is not supported in the browser build");
};

export const gzipSync = nope;
export const gunzipSync = nope;
export const gzip = nope;
export const gunzip = nope;
export const constants = {};

export default { gzipSync, gunzipSync, gzip, gunzip, constants };
