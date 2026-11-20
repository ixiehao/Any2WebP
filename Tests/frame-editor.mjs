import assert from "node:assert/strict";
import { delayAt, frameBudget, sameFrameEdit, sortFramePaths } from "../app/frame-editor.js";

assert.deepEqual(sortFramePaths(["/images/10.png", "/images/2.jpg", "/images/1.png"]),
  ["/images/1.png", "/images/2.jpg", "/images/10.png"]);
assert.equal(Array.from({ length: 12 }, (_, i) => delayAt(i, 12)).reduce((a, b) => a + b), 1000);
assert.deepEqual([delayAt(0, 10), delayAt(2, 10), 500], [100, 100, 500]);
assert.equal(frameBudget(1024, 1024, 128).fits, true);
assert.equal(frameBudget(1024, 1024, 129).fits, false);
assert.equal(frameBudget(320, 240, 601).fits, false);
assert.equal(frameBudget(320, 240, 1).fits, false);

const edit = { width: 320, height: 240, plays: 0, frames: [
  { path: "/images/1.png", index: 0, delay: 100 },
  { path: "/images/2.webp", index: 4, delay: 500 },
] };
assert.equal(sameFrameEdit(edit, structuredClone(edit)), true);
assert.equal(sameFrameEdit(edit, { ...edit, plays: 2 }), false);
assert.equal(sameFrameEdit(edit, { ...edit, height: 241 }), false);
const changed = structuredClone(edit);
changed.frames[1].delay = 499;
assert.equal(sameFrameEdit(edit, changed), false);
assert.equal(sameFrameEdit(edit, { ...edit, frames: [...edit.frames].reverse() }), false);
assert.equal(sameFrameEdit(edit, { ...edit, frames: edit.frames.slice(0, 1) }), false);
console.log("Frame editor: natural file order, frame timing, unchanged edits, and RGBA budget passed");
