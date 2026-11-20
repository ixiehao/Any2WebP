import assert from "node:assert/strict";
import { currentExport, planExports } from "../app/export-queue.js";

const settings = { destination: null, format: "webp", targetBytes: 0 };
const completed = { result: { path: "/source/result.webp" }, exportSettings: { ...settings } };
const failedRetry = { ...completed, error: { key: "destinationWrite" } };
const waiting = { path: "/source/new.png" };
assert.deepEqual(planExports([], settings), { queued: [], repeat: false });
assert.deepEqual(planExports([completed, failedRetry, waiting], settings),
  { queued: [failedRetry, waiting], repeat: false });
assert.deepEqual(planExports([completed], settings), { queued: [completed], repeat: true });
assert.deepEqual(planExports([completed, waiting], { ...settings, targetBytes: 10_240 }),
  { queued: [completed, waiting], repeat: false });
assert.deepEqual(planExports([completed], { ...settings, destination: "/exports" }),
  { queued: [completed], repeat: false });
assert.deepEqual(planExports([completed], { ...settings, format: "gif" }),
  { queued: [completed], repeat: false });
assert.equal(currentExport({ result: completed.result }, settings), false);
assert.equal(failedRetry.result, completed.result);
console.log("Export planning: mixed queues, changed settings, explicit re-export and failed retry passed");
