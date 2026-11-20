import assert from "node:assert/strict";
import { createUpdateChecker, UPDATE_INTERVAL } from "../app/update-check.js";

const cache = new Map();
const storage = { getItem: key => cache.get(key), setItem: (key, value) => cache.set(key, value) };
const available = tag => ({ status: "available", tag });
let clock = 1_800_000_000_000;
let state;
let calls = 0;
let answer;
const install = (installed = "0.2.13") => createUpdateChecker({
  installed,
  now: () => clock,
  storage,
  query: () => { calls++; return answer(); },
  onChange: next => { state = next; },
});

let checker = install();
assert.equal(state.tag, null);
let complete;
answer = () => new Promise(resolve => { complete = resolve; });
const background = checker.check();
assert.equal(state.status, "checking");
assert.equal(checker.check(true), background);
await Promise.resolve();
assert.equal(calls, 1);
complete(available("v0.2.14"));
await background;
assert.equal(state.tag, "v0.2.14");
assert.equal(state.status, "available");

checker = install();
assert.equal(state.tag, "v0.2.14");
assert.equal(checker.check(), undefined);
clock += UPDATE_INTERVAL;
answer = () => Promise.reject(new Error("offline"));
await checker.check();
assert.equal(state.status, "failed");
assert.equal(state.tag, "v0.2.14");

checker = install();
assert.equal(checker.check(), undefined);
answer = () => ({ status: "rateLimited", retryAt: (clock + 120_000) / 1000 });
await checker.check(true);
const retryAt = state.retryAt;
checker = install();
assert.equal(checker.check(), undefined);
assert.equal(checker.check(true), undefined);
assert.deepEqual(state, { status: "rateLimited", tag: "v0.2.14", retryAt });
assert.equal(calls, 3);
clock = retryAt;
answer = () => available("v0.10.0");
await checker.check();
assert.equal(state.tag, "v0.10.0");

checker = install("0.10.0");
assert.equal(state.tag, null);
answer = () => available("v0.10.1-rc.1");
await checker.check(true);
assert.equal(state.status, "failed");
assert.equal(state.tag, null);
answer = () => ({ status: "current" });
await checker.check(true);
assert.equal(state.status, "current");
answer = () => ({ status: "unpublished" });
await checker.check(true);
assert.equal(state.status, "unpublished");
assert.equal(state.tag, null);

answer = () => ({ status: "rateLimited", retryAt: (clock + 120_000) / 1000 });
await checker.check(true);
clock -= 1000;
checker = install();
answer = () => available("v1.0.0");
await checker.check();
assert.equal(state.tag, "v1.0.0");

checker = install("1.0.0");
answer = () => ({ status: "unpublished" });
await checker.checkAtLaunch();
checker = install("1.0.0");
assert.equal(checker.check(), undefined);
answer = () => available("v1.1.0");
await checker.checkAtLaunch();
assert.equal(state.tag, "v1.1.0");
assert.equal(checker.checkAtLaunch(), undefined);

console.log("Updates: concurrent checks, numeric versions, offline retention, persistent backoff and clock rollback passed");
