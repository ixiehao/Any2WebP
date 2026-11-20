import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { catalog, errorMessage, message, messageText, savedLanguage, setLanguage, systemLanguage, t } from "../app/i18n.js";

assert.equal(systemLanguage(["fr-FR", "ja-JP", "en-US"]), "ja");
assert.equal(systemLanguage(["zh-Hans-CN"]), "zh-CN");
assert.equal(systemLanguage(["de-DE"]), "en");
const selections = new Map();
globalThis.localStorage = { getItem: name => selections.get(name), setItem: (name, value) => selections.set(name, value) };
assert.equal(savedLanguage(), "system");
assert.deepEqual(setLanguage("system", ["ja-JP"]), { preference: "system", locale: "ja" });
assert.deepEqual(setLanguage("zh-CN", ["ja-JP"], true), { preference: "zh-CN", locale: "zh-CN" });
assert.equal(savedLanguage(), "zh-CN");
assert.deepEqual(setLanguage("system", ["de-DE", "en-US"], true), { preference: "system", locale: "en" });
assert.equal(savedLanguage(), "system");

const placeholders = text => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
for (const [key, translations] of Object.entries(catalog)) {
  assert.equal(translations.length, 3, key);
  assert.ok(translations.every(translation => translation.trim()), key);
  for (const text of translations) assert.deepEqual(placeholders(text), placeholders(translations[0]), key);
}
function source(path) { return readFileSync(new URL("../" + path, import.meta.url), "utf8"); }
const html = source("app/index.html");
for (const [, key] of html.matchAll(/data-i18n(?:-aria-label|-title)?="(\w+)"/g)) assert.ok(catalog[key], key);
for (const path of ["app/adjustment.js", "app/timeline.js", "app/video-navigation.js", "app/video-dependencies.js", "app/app.js",
  "app/frame-editor.js", "src-tauri/src/frames.rs", "src-tauri/src/main.rs", "src-tauri/src/video.rs",
  "src-tauri/src/video_tools.rs", "src-tauri/src/adjustment.rs", "src-tauri/src/updates.rs", "engine/codec.c"]) {
  for (const [, key] of source(path).matchAll(/"ui:(\w+)(?=[:"])/g)) assert.ok(catalog[key], path + ": " + key);
}
for (const path of ["app/app.js", "app/video-dependencies.js", "app/trim-editor.js", "app/frame-editor.js"]) {
  for (const [, key] of source(path).matchAll(/\b(?:t|message)\("(\w+)"(?=[,)])/g)) assert.ok(catalog[key], key);
}

const warning = message("loopAdjusted", { source: 65536, output: 65535 });
const error = errorMessage("ui:destinationWrite:Permission denied");
for (const language of ["zh-CN", "en", "ja"]) {
  setLanguage(language, []);
  assert.match(messageText(warning), /65535/);
  assert.equal(messageText(error), t("destinationWrite") + " · Permission denied");
}
assert.match(messageText(warning), /回/);
console.log("Localization: locale selection, persistence, catalog coverage and retranslation passed");
