import assert from "node:assert/strict";
import { clipFromPlayhead, formatTimecode, MAX_VIDEO_FPS, minimumClipMs, parseTimecode,
  stepSourceFrame, videoClipLimits, videoSettingsError } from "../app/trim-time.js";

const start = parseTimecode("00:08:27.243");
const end = parseTimecode("00:09:17.167");
assert.equal(formatTimecode(end - start), "00:00:49.924");
assert.equal(parseTimecode("507.243"), start);
assert.equal(parseTimecode("8:27.243"), start);
assert.equal(formatTimecode(parseTimecode("125:03:59.999")), "125:03:59.999");
for (const invalid of ["", "-1", "00:00:60", "00:61:00", "a:50", "1.0008", "3:5:1:2"]) {
  assert.equal(parseTimecode(invalid), null);
}

assert.equal(stepSourceFrame(2000, 5, 20, 0, 5000), 2250);
assert.equal(stepSourceFrame(2001, -5, 20, 0, 5000), 1800);
assert.equal(stepSourceFrame(0, -5, 20, 0, 5000), 0);
assert.equal(stepSourceFrame(3003, 5, 30000 / 1001, 0, 5000), 3170);
assert.equal(stepSourceFrame(3170, -5, 30000 / 1001, 0, 5000), 3003);

const info = { durationMs: 1_032_661, width: 640, height: 360, frameBudgetBytes: 192 * 1024 * 1024 };
assert.equal(videoSettingsError(info, { startMs: start, endMs: end, fps: 12, edge: 640 }), "maxFrames");
assert.equal(videoSettingsError(info, { startMs: start, endMs: end, fps: 12, edge: 320 }), "");
assert.equal(videoSettingsError(info, { startMs: 0, endMs: 83, fps: 12, edge: 320 }), "minFrames");
assert.equal(videoSettingsError(info, { startMs: 0, endMs: 84, fps: 12, edge: 320 }), "");
assert.equal(videoSettingsError(info, { startMs: end, endMs: start, fps: 12, edge: 320 }), "invalidTrim");

const limits = videoClipLimits(info, { fps: 12, edge: 640 });
assert.deepEqual(limits, { minMs: 84, maxMs: 18_167 });
assert.equal(videoClipLimits(info, { fps: 12, edge: 320 }).maxMs, 50_000);
assert.equal(videoClipLimits(info, { fps: 5, edge: 240 }).maxMs, 120_000);
assert.equal(videoClipLimits({ ...info, width: 1912, height: 1080 }, { fps: 12, edge: 640 }).maxMs, 18_083);
assert.equal(videoClipLimits({ ...info, durationMs: 4200 }, { fps: 12, edge: 640 }).maxMs, 4200);
assert.equal(videoSettingsError(info, { startMs: 5000, endMs: 23_167, fps: 12, edge: 640 }), "");
assert.equal(videoSettingsError(info, { startMs: 5000, endMs: 23_168, fps: 12, edge: 640 }), "maxFrames");
assert.deepEqual(clipFromPlayhead(4250, 12_000, 30_000, limits), { startMs: 4250, endMs: 16_250 });
assert.deepEqual(clipFromPlayhead(4250, 20_000, 30_000, limits), { startMs: 4250, endMs: 22_417 });
assert.deepEqual(clipFromPlayhead(29_916, 10_000, 30_000, limits), { startMs: 29_916, endMs: 30_000 });
assert.equal(clipFromPlayhead(29_917, 10_000, 30_000, limits), null);
const expanded = { ...info, frameBudgetBytes: 384 * 1024 * 1024 };
const tenSeconds = { startMs: 0, endMs: 10_000, fps: 24, edge: 640 };
assert.equal(videoSettingsError(info, tenSeconds), "maxFrames");
assert.equal(videoSettingsError(expanded, tenSeconds), "");
assert.equal(videoClipLimits(expanded, tenSeconds).maxMs, 18_167);
assert.equal(videoSettingsError(expanded, { ...tenSeconds, endMs: 18_168 }), "maxFrames");
assert.equal(videoClipLimits(expanded, { fps: 12, edge: 640 }).maxMs, 36_333);
assert.equal(videoClipLimits(expanded, { fps: 5, edge: 240 }).maxMs, 120_000);
const v020 = { ...info, width: 960, height: 540, frameBudgetBytes: 512 * 1024 * 1024 };
const testClip = { startMs: 0, endMs: 10_000, fps: 24, edge: 960 };
assert.equal(videoSettingsError({ ...v020, frameBudgetBytes: expanded.frameBudgetBytes }, testClip), "maxFrames");
assert.equal(videoSettingsError(v020, testClip), "");
assert.equal(videoClipLimits(v020, testClip).maxMs, 10_750);
assert.equal(videoSettingsError(v020, { ...testClip, endMs: 10_751 }), "maxFrames");
assert.equal(videoSettingsError(v020, { ...testClip, fps: MAX_VIDEO_FPS + 1 }), "invalidDimensions");
assert.equal(minimumClipMs(MAX_VIDEO_FPS), 34);
assert.equal(videoSettingsError(v020, { ...testClip, fps: MAX_VIDEO_FPS, endMs: 33 }), "minFrames");
assert.equal(videoSettingsError(v020, { ...testClip, fps: MAX_VIDEO_FPS, endMs: 34 }), "");
console.log("Trim timecodes, source-frame stepping, export limits and playhead presets passed");
