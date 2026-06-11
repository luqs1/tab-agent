import { test, expect } from "bun:test";
import { encodeWorkflowLink, decodeWorkflowHash, workflowParams, fillParams } from "./wf";

test("workflowParams returns unique placeholders in first-seen order, trimmed", () => {
  expect(workflowParams("Hi {{name}}, run {{ cmd }} then {{name}} again")).toEqual(["name", "cmd"]);
  expect(workflowParams("no placeholders here")).toEqual([]);
});

test("fillParams substitutes known values and leaves unknown ones intact", () => {
  expect(fillParams("a {{x}} b {{ y }}", { x: "1", y: "2" })).toBe("a 1 b 2");
  expect(fillParams("keep {{z}}", {})).toBe("keep {{z}}");
});

test("encode/decode round-trips a workflow through the URL fragment", async () => {
  (globalThis as any).location = { origin: "https://tab.agent", pathname: "/" };
  const wf = { title: "Set up", instructions: "do {{thing}} carefully" };
  const url = await encodeWorkflowLink(wf);
  expect(url).toContain("#wf=");
  const decoded = await decodeWorkflowHash(url.slice(url.indexOf("#")));
  expect(decoded).toEqual(wf);
});

test("encode/decode drops an empty title", async () => {
  (globalThis as any).location = { origin: "https://tab.agent", pathname: "/" };
  const url = await encodeWorkflowLink({ instructions: "just steps" });
  expect(await decodeWorkflowHash(url.slice(url.indexOf("#")))).toEqual({ instructions: "just steps" });
});

test("decodeWorkflowHash rejects malformed or absent fragments", async () => {
  expect(await decodeWorkflowHash("#nope")).toBeNull();
  expect(await decodeWorkflowHash("#wf=!!!not-base64url")).toBeNull();
  expect(await decodeWorkflowHash("")).toBeNull();
});
