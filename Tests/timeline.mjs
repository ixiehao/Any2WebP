import assert from "node:assert/strict";
import { comparisonFrameAt, edgePanSpeed, frameAt, moveTrimRange, playbackPosition, readPreview, readStampedPreview, timelineClock, timelineViewport, trimHandleLimits, trimPointerTime, zoomTimelineViewport } from "../app/timeline.js";

const bytes = new Uint8Array(40 + 12 + 12);
const header = new DataView(bytes.buffer);
[1, 1, 3, 2, 1, 5, 5, 1, 0, 123, 10, 0, 170].forEach((n, i) => header.setUint32(i * 4, n, true));
bytes.set(new TextEncoder().encode("APNG"), 32);
const media = readPreview(bytes);
assert.equal(media.info.format, "APNG");
assert.deepEqual(media.info.delays, [10, 0, 170]);
assert.deepEqual(media.starts, [0, 10, 110]);
assert.equal(media.duration, 280);
assert.equal(frameAt(media.starts, 9), 0);
assert.equal(frameAt(media.starts, 10), 1);
assert.equal(frameAt(media.starts, 110), 2);
assert.equal(frameAt(media.starts, media.duration), 2);
assert.deepEqual(playbackPosition(279, 280, 2), { position: 279, finished: false });
assert.deepEqual(playbackPosition(281, 280, 2), { position: 1, finished: false });
assert.deepEqual(playbackPosition(560, 280, 2), { position: 280, finished: true });
assert.deepEqual(playbackPosition(560, 280, 0), { position: 0, finished: false });

const comparisonSource = { revision: "original", count: 2, starts: [0, 85] };
const roundedGif = { count: 2, starts: [0, 90] };
assert.equal(comparisonFrameAt(comparisonSource, roundedGif, "original", 84), 0);
assert.equal(comparisonFrameAt(comparisonSource, roundedGif, "original", 85), 1);
assert.equal(comparisonFrameAt(comparisonSource, roundedGif, "different", 85), 0);
assert.equal(comparisonFrameAt(comparisonSource, { count: 3, starts: [0, 90, 160] }, "original", 85), 0);
console.log("Timeline: format, raw delays, stepping and loop termination passed");

const revision = new TextEncoder().encode("1:2:3:4.5:6.7");
const stamped = new Uint8Array(bytes.length + revision.length + 4);
stamped.set(bytes);
stamped.set(revision, bytes.length);
new DataView(stamped.buffer).setUint32(stamped.length - 4, revision.length, true);
assert.equal(readStampedPreview(stamped.buffer).revision, "1:2:3:4.5:6.7");
assert.deepEqual(readStampedPreview(stamped).info, media.info);
assert.throws(() => readStampedPreview(stamped.subarray(0, -4)));

const range = { startMs: 425, endMs: 1355 };
assert.deepEqual(trimHandleLimits("start", range, 3200, 15), [0, 1287]);
assert.deepEqual(trimHandleLimits("end", range, 3200, 15), [493, 3200]);
assert.deepEqual(trimHandleLimits("start", { startMs: 0, endMs: 10 }, 10, 60), [0, 0]);
assert.deepEqual(trimHandleLimits("end", { startMs: 0, endMs: 10 }, 10, 60), [10, 10]);
assert.equal(trimPointerTime(425, 0, 641, 3200), 425);
assert.equal(trimPointerTime(425, 64, 640, 3200), 745);
assert.equal(trimPointerTime(1355, -64, 640, 3200), 1035);
assert.deepEqual(moveTrimRange(range, 319, 3200), { startMs: 744, endMs: 1674 });
assert.deepEqual(moveTrimRange(range, -2000, 3200), { startMs: 0, endMs: 930 });
assert.deepEqual(moveTrimRange(range, 5000, 3200), { startMs: 2270, endMs: 3200 });
console.log("Trim ruler: handle separation and relative pointer mapping passed");

const { createVideoReader, filmstripIndex, readVideoFrames } = await import("../app/video-navigation.js");
const navigationFrame = new Uint8Array(16);
[1, 1, 1].forEach((n, index) => new DataView(navigationFrame.buffer).setUint32(index * 4, n, true));
assert.equal(readVideoFrames(navigationFrame).count, 1);
assert.throws(() => readVideoFrames(navigationFrame.subarray(1)));
const viewport = { startMs: 40000, endMs: 42000 };
assert.deepEqual(timelineViewport(120000, -100, 15000), { startMs: 0, endMs: 15000 });
assert.deepEqual(timelineViewport(120000, 119999, 15000), { startMs: 105000, endMs: 120000 });
assert.deepEqual(timelineViewport(500, 200, 200), { startMs: 0, endMs: 500 });
assert.deepEqual(zoomTimelineViewport(120000, viewport, .5, 40500, .25),
  { startMs: 40250, endMs: 41250 });
assert.deepEqual(zoomTimelineViewport(120000, viewport, 2, 41000),
  { startMs: 39000, endMs: 43000 });
assert.equal(timelineClock(61025), "1:01.025");
assert.equal(edgePanSpeed(100, 500, 2000), 0);
assert.equal(edgePanSpeed(18, 500, 2000), -850);
assert.equal(edgePanSpeed(482, 500, 2000), 850);
assert.equal(edgePanSpeed(-50, 500, 2000), -1700);
assert.equal(edgePanSpeed(550, 500, 2000), 1700);
assert.equal(edgePanSpeed(19, 60, 2000), 0);
assert.equal(filmstripIndex(40000, viewport, 8), 0);
assert.equal(filmstripIndex(41000, viewport, 8), 4);
assert.equal(filmstripIndex(42000, viewport, 8), 7);

const pending = [];
const cancelled = [];
const painted = [];
let sequence = 0;
const reader = createVideoReader((command, args) => {
  if (command === "cancel_video_navigation") {
    cancelled.push(args.requestId);
    return Promise.resolve();
  }
  return new Promise(resolve => pending.push({ ...args, resolve }));
}, () => ++sequence, true);
const seek = (time) => reader.request("/clip.mp4", { timeMs: time }, () => painted.push(time));
seek(100);
seek(200);
seek(300);
assert.deepEqual(pending.map(request => request.timeMs), [100]);
pending[0].resolve(navigationFrame);
for (let i = 0; pending.length < 2 && i < 100; i++) {
  await new Promise(resolve => setTimeout(resolve, 5));
}
assert.deepEqual(pending.map(request => request.timeMs), [100, 300]);
reader.cancel();
pending[1].resolve(navigationFrame);
await new Promise(resolve => setTimeout(resolve, 0));
assert.deepEqual(cancelled, [2]);
assert.deepEqual(painted, [100]);
console.log("Filmstrip: packet checks, latest pending seek, and cancellation passed");
