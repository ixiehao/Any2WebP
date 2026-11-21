import { currentLanguage, currentPreference, errorMessage, message, messageText, savedLanguage, setLanguage, systemLanguage, t } from "./i18n.js";
import { adjustImage, loadAdjustment } from "./adjustment.js";
import { frameAt, playbackPosition, readStampedPreview } from "./timeline.js";
import { bindTrimEditor } from "./trim-editor.js";
import { bindFrameEditor } from "./frame-editor.js";
import { formatTimecode, videoSettingsError } from "./trim-time.js";
import { createUpdateChecker } from "./update-check.js";
import { currentExport, planExports } from "./export-queue.js";
import { bindVideoDependencies, dependencyError } from "./video-dependencies.js";
import { bytesPerKB, fileLimitBytes, sizeText } from "./byte-size.js";

const { app: tauriApp, core: { invoke }, event: appEvents, webview } = window.__TAURI__;
const $ = (id) => document.getElementById(id);
const files = [];
const queueRows = new Map();
const clock = { scrub: $("scrub"), time: $("time"), position: 0, updatedAt: 0 };
const players = {
  before: { canvas: $("before"), message: $("before-message"), info: $("before-size"), fact: $("facts-before-frame") },
  after: { canvas: $("after"), message: $("after-message"), info: $("after-size"), fact: $("facts-after-frame") },
};
for (const player of Object.values(players)) {
  player.context = player.canvas.getContext("2d");
  player.media = null;
  player.drawn = -1;
}

let selected = null;
let destination = null;
let batch = null;
let batchReport = null;
let nextJob = Date.now() * 1000;
let nextFile = 0;
let previewRequest = null;
let previewTimer = 0;
let nextPreviewId = nextJob;
let activePreviewId = null;
let loading = false;
let pickingInput = false;
let elapsed = 0;
let started = null;
let raf = 0;
const basename = (path) => path.split("/").at(-1) || path;
const videoFields = ["clip-fps", "clip-edge"];
const neutralQuality = Object.freeze({ shadows: 0, denoise: 0, sharpen: 0 });
const qualityOptions = Object.keys(neutralQuality);
const errorText = (error) => error instanceof Error ? error.message : String(error);
const localizedText = new Map();
let preferredLanguages = navigator.languages;
let updateState = null;

function setText(element, value) {
  const node = typeof element === "string" ? $(element) : element;
  localizedText.set(node, value);
  node.textContent = messageText(value);
}

function refreshLanguage(choice, save = false) {
  const { preference, locale } = setLanguage(choice, preferredLanguages, save);
  document.documentElement.lang = locale;
  for (const node of document.querySelectorAll("[data-i18n]")) node.textContent = t(node.dataset.i18n);
  for (const attribute of ["aria-label", "title"]) {
    for (const node of document.querySelectorAll("[data-i18n-" + attribute + "]")) {
      node.setAttribute(attribute, t(node.getAttribute("data-i18n-" + attribute)));
    }
  }
  for (const [node, value] of localizedText) node.textContent = messageText(value);
  renderQueue();
  renderVideoRange(selected);
  trimEditor.refresh();
  frameEditor.refresh();
  playbackButtons();
  renderFacts(clock.position);
  if (updateState) renderUpdateState(updateState);
  const menuKeys = ["About", "Hide", "HideOthers", "Services", "Quit", "File", "Edit", "Undo", "Redo",
    "Cut", "Copy", "Paste", "SelectAll", "View", "Window", "Minimize", "Zoom", "Close", "FullScreen", "Help", "Language"];
  const labels = { ...Object.fromEntries(menuKeys.map(key => [key, t("menu" + key)])),
    AddFiles: t("addFiles"), CheckUpdates: t("checkUpdates"), DependencyCheck: t("checkDependencies"),
    FollowSystem: t("followSystem"),
    AboutDetails: {
      locale,
      description: t("aboutDescription"),
      developer: t("aboutDeveloper"),
      website: t("aboutWebsite"),
      feedback: t("aboutFeedback"),
      localProcessing: t("aboutLocalProcessing"),
      license: t("aboutLicense"),
    },
  };
  menuEventsReady.then(() => invoke("set_menu_language", { labels, preference })).catch(console.warn);
}

async function updateSystemLanguage() {
  const languages = await invoke("system_languages").catch(() => []);
  preferredLanguages = languages.length ? languages : navigator.languages;
  if (currentPreference() === "system" && currentLanguage() !== systemLanguage(preferredLanguages)) {
    refreshLanguage("system");
  }
}


function setStatus(message, tone = "") {
  setText("status", message);
  $("status").className = "status " + tone;
}

function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const use = document.createElementNS(svg.namespaceURI, "use");
  use.setAttribute("href", "#" + name);
  svg.setAttribute("aria-hidden", "true");
  svg.append(use);
  return svg;
}

function renderQueue() {
  const queue = $("queue");
  const settings = exportSettings();
  const locked = Boolean(batch);
  const locale = currentLanguage();
  const ids = new Set(files.map(file => file.id));
  for (const [id, row] of queueRows) {
    if (ids.has(id)) continue;
    row.item.remove();
    queueRows.delete(id);
  }
  for (const file of files) {
    let row = queueRows.get(file.id);
    if (!row) {
      row = createQueueRow(file);
      queueRows.set(file.id, row);
      queue.append(row.item);
    }
    const selectedRow = file === selected;
    if (row.selected !== selectedRow) {
      row.selected = selectedRow;
      row.item.classList.toggle("selected", selectedRow);
      row.select.setAttribute("aria-pressed", String(selectedRow));
      row.select.tabIndex = selectedRow ? 0 : -1;
      row.remove.tabIndex = selectedRow ? 0 : -1;
    }
    if (row.remove.disabled !== locked) row.remove.disabled = locked;
    if (row.locale !== locale) row.remove.setAttribute("aria-label", t("remove", { name: row.name }));
    syncQueueStatus(row, file, settings, locale);
  }
  const count = String(files.length);
  if ($("count").textContent !== count) $("count").textContent = count;
  $("clear").disabled = locked || !files.length;
  renderInputActions();
  const editable = Boolean(selected && !selected.video &&
    players.before.media?.sourceFile === selected && selected.info?.animated);
  $("edit-frames").hidden = !editable;
  $("edit-frames").disabled = locked;
  renderExportAction(settings);
  $("output-format").disabled = locked;
  $("mode").disabled = $("target").disabled = $("destination").disabled = $("reset-destination").disabled = locked;
  for (const id of [...videoFields, "edit-clip"]) $(id).disabled = locked || !selected?.videoInfo;
  updateQualityControls();
}

function syncQueueStatus(row, file, settings, locale) {
  const isCurrent = currentExport(file, settings);
  if (row.locale !== locale || row.info !== file.info || row.result !== file.result || row.active !== file.active ||
      row.error !== file.error || row.videoError !== file.videoError ||
      row.dependencyError !== file.dependencyError || row.current !== isCurrent) {
    renderQueueStatus(row, file, isCurrent);
    Object.assign(row, { locale, info: file.info, result: file.result, active: file.active,
      error: file.error, videoError: file.videoError, dependencyError: file.dependencyError, current: isCurrent });
  }
}

function createQueueRow(file) {
  const item = document.createElement("div");
  item.className = "queue-item";
  const select = document.createElement("button");
  select.type = "button";
  select.className = "queue-select";
  select.dataset.fileId = file.id;
  select.title = file.path;
  select.onclick = () => selectFile(file);
  const mark = document.createElement("span");
  mark.className = "file-icon";
  const iconElement = icon("image");
  mark.append(iconElement);
  const text = document.createElement("span");
  text.className = "file-text";
  const title = document.createElement("span");
  title.className = "file-name";
  const name = fileName(file);
  title.textContent = name;
  const progress = document.createElement("span");
  text.append(title, progress);
  select.append(mark, text);
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "remove";
  remove.append(icon("remove"));
  remove.onclick = () => {
    if (batch) return;
    const focused = item.contains(document.activeElement);
    const index = files.indexOf(file);
    if (index < 0) return;
    files.splice(index, 1);
    if (file === selected) selectFile(files[Math.min(index, files.length - 1)] ?? null);
    else renderQueue();
    if (focused) (queueRows.get(selected?.id)?.select ?? $("add-files")).focus({ preventScroll: true });
  };
  item.append(select, remove);
  return { item, select, remove, name, progress, statusIcon: iconElement.firstChild };
}

function renderQueueStatus(row, file, isCurrent) {
  const { result, error, active, videoError, info } = file;
  const warning = result?.targetMet === false || loopCapped(result) || info?.recovered || (result && !isCurrent);
  row.progress.className = "file-status " + (error || videoError || file.dependencyError ? "error" : warning ? "warning" : result ? "ok" : "");
  row.progress.textContent = active ? t("processing") : file.dependencyError ? t("dependencyCheck")
    : error ? t("failed") : videoError ? t("invalidClip")
    : result ? messageText([
      !isCurrent && message("exportNeedsUpdate"),
      result.targetMet === false && message("targetMissed"),
      loopCapped(result) && message("loopAdjustedShort"),
      result.source.recovered && message("gifRecoveredShort"),
      sizeText(result.output.bytes),
    ]) : info ? messageText([displaySourceFormat(info), sizeText(info.bytes), info.recovered && message("gifRecoveredShort")])
      : t("waiting");
  row.statusIcon.setAttribute("href", !active && isCurrent && result?.targetMet !== false ? "#check" : "#image");
}

function exportSettings() {
  return {
    destination,
    format: $("settings").elements.format.value,
    targetBytes: $("mode").value === "target" ? Number($("target").value) * bytesPerKB : 0,
  };
}

function renderFormat(format) {
  const gif = format === "gif";
  $("default-mode").textContent = t(gif ? "gifStandard" : "lossless");
  $("target-note").textContent = t(gif ? "gifTargetNote" : "targetNote");
  $("gif-note").hidden = !gif;
}

function renderExportAction(settings = exportSettings()) {
  renderFormat(settings.format);
  const plan = batch ? null : planExports(files, settings);
  $("run").disabled = batch ? batch.stopping : !plan.queued.length;
  $("run").dataset.running = String(Boolean(batch));
  setText("run-label", batch ? message(batch.stopping ? "cancelling" : "cancelConversion")
    : plan.queued.length ? message(plan.repeat ? "reexportCount" : "exportCount", { count: plan.queued.length })
      : message("exportFormatAction", { format: formatName(settings.format) }));
  const status = batch ? message("exportingCount", { index: batch.index, total: batch.total }) : batchReport?.text;
  const notice = $("batch-status");
  notice.hidden = !status;
  notice.classList.toggle("warning", !batch && Boolean(batchReport?.warning));
  if (notice.textContent !== messageText(status)) setText(notice, status);
  const progress = $("batch-progress");
  progress.hidden = !batch;
  if (batch) {
    progress.max = batch.total;
    progress.value = Math.max(0, batch.index - 1);
  }
  showOutput(selected);
  if (selected?.result) setText("after-title", message(currentExport(selected, settings) ? "converted" : "previousExport"));
}

function loopCapped(result) {
  return Boolean(result?.source.animated && result.output.animated && result.source.plays !== result.output.plays);
}

const formatName = (format) => format === "gif" ? "GIF" : "WebP";
const displaySourceFormat = info => info.format === "FRMS" ? t("frameEditorSource") : info.format;
const fileName = file => file.synthetic ? basename(file.path).replace(/\.[^.]*$/, "") + "-animation" : basename(file.path);

function outcome(file) {
  setStatus(file?.error, file?.error ? "error" : "");
}

function setPlayer(side, media, message = "", result = null) {
  const player = players[side];
  player.media = media;
  player.drawn = -1;
  player.canvas.hidden = !media;
  player.message.hidden = Boolean(media);
  setText(player.message, message);
  player.info.textContent = media ? displaySourceFormat(media.info) + " · " + sizeText(media.info.bytes) : "—";
  const width = media?.width ?? 1;
  const height = media?.height ?? 1;
  if (player.canvas.width !== width) player.canvas.width = width;
  if (player.canvas.height !== height) player.canvas.height = height;
  if (side === "after") {
    player.result = result;
    renderResultFacts();
  }
}

function draw(position, updateClock = true) {
  clock.position = position;
  for (const player of Object.values(players)) {
    if (!player.media) continue;
    const { starts, info, count } = player.media;
    const frame = frameAt(starts, position);
    if (frame === player.drawn && player.drawnLocale === currentLanguage()) continue;
    if (frame !== player.drawn) player.context.putImageData(player.media.image(frame), 0, 0);
    player.drawn = frame;
    player.drawnLocale = currentLanguage();
    const value = info.animated ? (frame + 1) + " / " + count + " · " + info.delays[frame] + " ms" : t("stillImage");
    if (player.fact.textContent !== value) player.fact.textContent = value;
  }
  if (updateClock) drawClock(position);
}

function drawClock(position) {
  const source = players.before.media;
  if (!source) return;
  const ms = String(Math.round(position));
  const text = (position / 1000).toFixed(2) + " / " + (source.duration / 1000).toFixed(2) + " s";
  const title = selected?.videoSettings
    ? t("sourceTime", { time: ((selected.videoSettings.startMs + position) / 1000).toFixed(3) }) : "";
  if (clock.scrub.value !== ms) clock.scrub.value = ms;
  if (clock.time.textContent !== text) clock.time.textContent = text;
  if (clock.time.title !== title) clock.time.title = title;
}

function updatePlaybackAvailability() {
  const animated = Boolean(players.before.media?.info.animated);
  // Keep the clip controls under the pointer when playback is temporarily locked.
  $("timeline").hidden = !(animated || selected?.video);
  const enabled = animated;
  for (const id of ["scrub", "play", "previous-frame", "next-frame"]) $(id).disabled = !enabled;
}

function populateFacts(side, info, path) {
  const prefix = "facts-" + side + "-";
  const name = $(prefix + "name");
  name.textContent = path ? basename(path) : "";
  name.title = path || "";
  if (!info) return;
  const { width, height, plays, alpha, animated } = info;
  $(prefix + "dimensions").textContent = width + " × " + height;
  $(prefix + "loop").textContent = animated ? (plays ? t("plays", { count: plays }) : t("infinite")) : "—";
  $(prefix + "alpha").textContent = t(alpha ? "transparent" : "opaque");
}

function renderResultFacts() {
  const result = selected?.result;
  const current = Boolean(result && players.after.result === result);
  const media = current ? players.after.media : null;
  $("facts-after-values").hidden = !media;
  populateFacts("after", media?.info, media ? result.path : null);
  if (media) $("facts-after-frame-label").textContent = t(media.info.animated ? "resultFrame" : "pictureType");
  const notice = $("facts-after-message");
  notice.hidden = Boolean(media);
  if (!media) setText(notice, message(current ? "resultDetailsUnavailable" : result ? "loadingResult" : "resultDetailsPending"));
  renderResultSummary(media ? result : null);
}

function renderResultSummary(result) {
  const summary = $("facts-after-summary");
  summary.hidden = !result;
  if (!result) return;
  const { source, output, quality, targetMet } = result;
  const ratio = (1 - output.bytes / source.bytes) * 100;
  const percent = Math.abs(ratio).toFixed(1).replace(/\.0$/, "");
  const difference = Math.abs(ratio) < 0.05 ? message("sameSize")
    : message(ratio > 0 ? "smaller" : "larger", { percent });
  const mode = { original: "modeOriginal", lossless: "modeLossless", lossy: "modeLossy", palette: "modeGif" }[result.mode];
  const capped = loopCapped(result);
  const count = source.delays.length;
  summary.textContent = messageText([
    message(mode, { quality }), difference,
    targetMet !== null && message(targetMet ? "targetMetDetail" : "targetMissed"),
    capped && message("loopAdjustedShort"),
    source.recovered && message("gifRecoveredCount", { count }),
  ]);
  summary.title = messageText([
    targetMet === false && message("targetMissedDetail"),
    capped && message("loopAdjusted", { source: source.plays, output: output.plays }),
    source.recovered && message("gifRecovered", { count }),
  ]);
  summary.classList.toggle("warning", targetMet === false || capped || source.recovered);
}

function renderFacts(position = 0) {
  const source = players.before.media;
  const hasSource = Boolean(source && source.sourceFile === selected);
  $("facts").hidden = !hasSource;
  renderResultFacts();
  updatePlaybackAvailability();
  $("scrub").max = hasSource ? source.duration || 1 : 1;
  if (!hasSource) {
    clock.position = 0;
    $("time").textContent = "0.00 / 0.00 s";
    $("time").title = "";
    $("scrub").value = 0;
    return;
  }
  populateFacts("before", source.info, selected.path);
  if (selected.synthetic) $("facts-before-name").textContent = fileName(selected);
  $("before-title").textContent = t(selected.video ? "sourceClip" : selected.frameEdit ? "frameEditorSource" : "original");
  const sourceSize = displaySourceFormat(source.info) + " · " + sizeText(source.info.bytes);
  if ($("before-size").textContent !== sourceSize) $("before-size").textContent = sourceSize;
  $("facts-before-frame-label").textContent = t(!source.info.animated ? "pictureType"
    : selected.video ? "previewFrame" : "currentFrame");
  $("facts-before-warning").hidden = !source.info.recovered;
  if (source.info.recovered) setText("facts-before-warning", message("gifRecovered", { count: source.count }));
  draw(position);
}

function playbackButtons() {
  $("play-symbol").setAttribute("href", started === null ? "#play-icon" : "#pause-icon");
  $("play").title = t(started === null ? "play" : "pause");
  $("play").setAttribute("aria-label", $("play").title);
}

function pause() {
  if (started !== null) {
    elapsed += performance.now() - started;
    drawClock(clock.position);
  }
  started = null;
  cancelAnimationFrame(raf);
  playbackButtons();
}

function tick(now) {
  const source = players.before.media;
  if (started === null || !source) return;
  const time = playbackPosition(Math.max(0, elapsed + now - started), source.duration, source.info.plays);
  const updateClock = time.finished || now - clock.updatedAt >= 32;
  if (updateClock) clock.updatedAt = now;
  draw(time.position, updateClock);
  if (time.finished) {
    pause();
    elapsed = source.duration * source.info.plays;
  } else {
    raf = requestAnimationFrame(tick);
  }
}

function seek(position) {
  pause();
  elapsed = position;
  draw(position);
}

function renderVideoFields(file) {
  $("video-settings").hidden = !file?.video;
  setText("before-title", message(file?.video ? "sourceClip" : "original"));
  if (!file?.video) return;
  const info = file.videoInfo;
  setText("video-meta", info ? message("videoMeta", {
    time: (info.durationMs / 1000).toFixed(3), width: info.width, height: info.height,
  }) : message("loadingVideoInfo"));
  const settings = file.videoSettings;
  const values = file.videoDraft || (settings ? [settings.fps, settings.edge] : []);
  renderVideoEdgeOptions(info, values[1]);
  videoFields.forEach((id, index) => { $(id).value = values[index] ?? ""; });
  renderVideoRange(file);
  renderVideoNote(file);
}

function renderVideoEdgeOptions(info, current) {
  const select = $("clip-edge");
  for (const option of select.querySelectorAll("[data-dynamic]")) option.remove();
  const original = Math.max(info?.width ?? 0, info?.height ?? 0);
  const contains = (value) => Array.from(select.options).some(option => Number(option.value) === value);
  if (original >= 2 && original <= 1920 && !contains(original)) {
    const option = new Option(t("originalEdge"), original);
    option.dataset.dynamic = "";
    option.dataset.i18n = "originalEdge";
    select.prepend(option);
  }
  const value = Number(current);
  if (value >= 2 && value <= 1920 && !contains(value)) {
    const option = new Option(value + " px", value);
    option.dataset.dynamic = "";
    select.prepend(option);
  }
}

function renderVideoRange(file) {
  const range = file?.videoSettings;
  $("video-range").hidden = !range;
  $("video-meta").hidden = Boolean(range);
  $("video-summary").title = range ? $("video-meta").textContent : "";
  if (range) {
    setText("video-range", message("trimSummary", {
      start: formatTimecode(range.startMs), end: formatTimecode(range.endMs),
    }));
  }
}

function renderVideoNote(file) {
  const note = $("video-note");
  note.hidden = !file.videoError || Boolean(file.dependencyError);
  setText(note, file.videoError ? message(file.videoError) : null);
  $("video-dependency").hidden = !file.dependencyError;
}

function renderQualityFields(file) {
  $("quality-settings").hidden = !file;
  for (const option of qualityOptions) {
    const strength = file?.adjustment?.[option] ?? 0;
    $("quality-" + option).value = strength;
    $("quality-" + option + "-value").textContent = strength + "%";
  }
  $("quality-summary").hidden = sameQuality(file?.adjustment);
}

function sameQuality(first = neutralQuality, second = neutralQuality) {
  return qualityOptions.every(option => first[option] === second[option]);
}

function updateQualityControls() {
  const locked = Boolean(batch || !selected);
  for (const option of qualityOptions) $("quality-" + option).disabled = locked;
  $("quality-reset").disabled = locked || sameQuality(selected?.adjustment);
  $("quality-apply-all").disabled = locked || files.length < 2;
}

function stopPreviewRequest() {
  clearTimeout(previewTimer);
  previewRequest = null;
  if (activePreviewId !== null) {
    invoke("cancel_preview", { requestId: activePreviewId }).catch(() => {});
  }
}

async function previewCall(command, args) {
  const requestId = ++nextPreviewId;
  activePreviewId = requestId;
  try {
    return await invoke(command, { ...args, requestId });
  } finally {
    activePreviewId = null;
  }
}

function queueComparison(file, { delay = 0, before = null, refreshVideo = false, trimVideo = false } = {}) {
  stopPreviewRequest();
  if (!file || (file.videoError && !trimVideo)) return;
  const request = { file, result: file.result, before, refreshVideo, trimVideo };
  const start = () => {
    previewRequest = request;
    updatePreview();
  };
  if (delay) previewTimer = setTimeout(start, delay);
  else start();
}

function showOutput(file) {
  $("reveal").hidden = !file?.result;
  $("reveal").title = file?.result?.path || "";
}

function showsAdjustment(file) {
  return Boolean(file?.adjustment && !file.result && !file.active && !file.error && !file.videoError);
}

function prepareAfterPlayer(file, original) {
  const adjustment = showsAdjustment(file);
  setText("after-title", message(adjustment ? "adjustedPreview"
    : file?.result && !currentExport(file, exportSettings()) ? "previousExport" : "converted"));
  if (adjustment && original) {
    const strengths = file.adjustment;
    setPlayer("after", {
      ...original,
      image(index) { return adjustImage(original.image(index), strengths); },
    });
    $("after-size").textContent = original.info.width + " × " + original.info.height;
    draw(clock.position);
    return;
  }
  const label = file?.result ? "loadingResult" : file?.active ? "encoding"
    : adjustment ? "loadingAdjustment" : "noResult";
  setPlayer("after", null, message(label, { format: formatName(exportSettings().format) }));
}

function resetComparison(file, options) {
  pause();
  elapsed = 0;
  setPlayer("before", null, message(file?.videoError || (file?.video ? "loadingClip" : "loadingImage")));
  prepareAfterPlayer(file);
  renderFacts();
  queueComparison(file, options);
}

function selectFile(file, { trimVideo = false } = {}) {
  const preview = { refreshVideo: true, trimVideo };
  if (file === selected) {
    if (trimVideo) resetComparison(file, preview);
    return;
  }
  trimEditor.close();
  frameEditor.close();
  selected = file;
  $("empty").hidden = Boolean(file);
  $("comparison").hidden = !file;
  $("workspace-heading").hidden = !file;
  $("selected-name").textContent = file ? fileName(file) : "";
  $("selected-name").title = file?.path || "";
  showOutput(file);
  outcome(file);
  renderVideoFields(file);
  renderQualityFields(file);
  updateDestinationActions();
  renderQueue();
  resetComparison(file, preview);
}

function settingsKey(settings) {
  return settings ? [settings.startMs, settings.endMs, settings.fps, settings.edge].join("/") : "";
}

function refreshResult(file, delay = 0) {
  showOutput(file);
  const original = players.before.media;
  if (original?.sourceFile === file && original.settingsKey === settingsKey(file.videoSettings) &&
      (!file.result || original.revision === file.result.sourceRevision)) {
    prepareAfterPlayer(file, original);
    if (file.result || showsAdjustment(file)) queueComparison(file, { before: original, delay });
    else stopPreviewRequest();
  } else {
    resetComparison(file, { delay, refreshVideo: Boolean(file.result) });
  }
}

function setQuality(file, strengths) {
  if (sameQuality(file.adjustment, strengths)) return false;
  file.adjustment = { ...strengths };
  file.result = null;
  file.error = null;
  return true;
}

function editSelectedQuality(strengths, delay = 0) {
  const file = selected;
  if (!file || batch) return false;
  const hadOutcome = Boolean(file.result || file.error);
  if (!setQuality(file, strengths)) return false;
  renderQualityFields(file);
  if (hadOutcome) {
    outcome(file);
    renderQueue();
  } else {
    updateQualityControls();
  }
  if (!file.videoError) refreshResult(file, delay);
  return true;
}

function qualityEdit() {
  const strengths = Object.fromEntries(qualityOptions.map(option => [option, Number($("quality-" + option).value)]));
  editSelectedQuality(strengths, 170);
}

function applyQualityToAll() {
  if (batch || !selected || files.length < 2) return;
  const strengths = selected.adjustment ?? neutralQuality;
  let changed = 0;
  for (const file of files) {
    if (file !== selected && setQuality(file, strengths)) changed++;
  }
  if (changed) renderQueue();
  setStatus(changed ? message("syncedQuality", { count: changed }) : message("alreadySynced"));
}

function editedVideoSettings(file, range = file.videoSettings) {
  return {
    ...range,
    fps: Number($("clip-fps").value),
    edge: Number($("clip-edge").value),
  };
}

function videoEdit(delay = 260, range) {
  const file = selected;
  if (!file?.videoInfo || batch) return;
  const settings = editedVideoSettings(file, range);
  const error = videoSettingsError(file.videoInfo, settings);
  const same = settingsKey(file.videoSettings) === settingsKey(settings);
  const wasInvalid = Boolean(file.videoError);
  file.videoDraft = videoFields.map(id => $(id).value);
  file.videoError = error;
  renderVideoNote(file);
  if (!error && !wasInvalid && same) return;
  if (!error) file.videoSettings = settings;
  file.result = null;
  file.error = null;
  renderVideoRange(file);
  outcome(file);
  renderQueue();
  resetComparison(file, { delay });
}

async function updatePreview() {
  if (loading) return;
  loading = true;
  // Export already decodes the source for the active item. Resume a pending
  // comparison when that conversion settles or the user selects another item.
  while (previewRequest && !previewRequest.file.active) {
    const request = previewRequest;
    const current = () => previewRequest === request;
    const { file, result } = request;
    try {
      let original = request.before;
      if (!original) {
        if (file.video && (!file.videoInfo || request.refreshVideo)) {
          const info = await previewCall("probe_video", { path: file.path });
          if (!current()) continue;
          file.dependencyError = null;
          file.videoInfo = info;
          file.videoSettings ??= info.defaults;
          renderVideoFields(file);
        }
        if (request.trimVideo) openClip(file);
        const settings = file.videoSettings;
        original = readStampedPreview(await previewCall("preview", {
          path: file.path, videoSettings: settings, frameEdit: file.frameEdit,
        }));
        if (!current()) continue;
        original.sourceFile = file;
        original.settingsKey = settingsKey(settings);
        if (file.videoInfo) original.info.bytes = file.videoInfo.bytes;
        file.info = original.info;
        setPlayer("before", original);
        renderFacts();
        renderQueue();
      }
      if (result) {
        try {
          if (original.revision !== result.sourceRevision) {
            throw new Error("ui:sourceChanged");
          }
          const optimized = result.path === file.path ? original
            : readStampedPreview(await previewCall("preview", { path: result.path }));
          if (!current()) continue;
          if (optimized.revision !== result.outputRevision) {
            throw new Error("ui:outputChanged");
          }
          setPlayer("after", optimized, "", result);
          draw(clock.position);
        } catch (error) {
          if (current()) setPlayer("after", null, errorMessage(error), result);
        }
      } else if (showsAdjustment(file)) {
        try {
          const strengths = file.adjustment;
          const adjusted = qualityOptions.some(option => strengths[option])
            ? readStampedPreview(await previewCall("preview", {
              path: file.path, videoSettings: file.videoSettings, adjustment: strengths, frameEdit: file.frameEdit,
            }))
            : original;
          if (!current()) continue;
          if (adjusted.revision !== original.revision) {
            throw new Error("ui:sourceChanged");
          }
          setPlayer("after", adjusted);
          $("after-size").textContent = adjusted.info.width + " × " + adjusted.info.height;
          draw(clock.position);
        } catch (error) {
          if (current()) setPlayer("after", null, errorMessage(error));
        }
      }
    } catch (error) {
      if (current()) {
        setPlayer("before", null, errorMessage(error));
        renderFacts();
        if (file.video) {
          file.dependencyError = dependencyError(errorText(error));
          if (!file.videoInfo) setText("video-meta", message("readFailed"));
          renderVideoNote(file);
          renderQueue();
        }
      }
    }
    if (current()) previewRequest = null;
  }
  loading = false;
}

function addPaths(paths, { trimVideo = false } = {}) {
  let skipped = 0;
  let videoToTrim = null;
  const known = new Map(files.filter(file => !file.synthetic).map(file => [file.path, file]));
  for (const path of paths) {
    const video = /\.(mp4|mov|webm)$/i.test(path);
    if (!video && (trimVideo || !/\.(gif|webp|png|apng|jpe?g|heic|heif|avif|tiff?|bmp|ico|psd|jp2|j2k|jxl)$/i.test(path))) {
      skipped++;
      continue;
    }
    let file = known.get(path);
    if (!file) {
      file = { id: ++nextFile, path, video };
      known.set(path, file);
      files.push(file);
    }
    if (trimVideo) videoToTrim ??= file;
  }
  if (videoToTrim) selectFile(videoToTrim, { trimVideo: true });
  else if (!selected && files.length) selectFile(files[0]);
  else renderQueue();
  if (skipped) setStatus(message("unsupportedCount", { count: skipped }), "warning");
}

function renderInputActions() {
  $("add-files").disabled = $("empty-add").disabled = pickingInput;
  $("create-animation").disabled = $("video-to-animation").disabled = pickingInput || Boolean(batch);
}

async function pickAtEntry(pick, accept, needsIdle = false) {
  if (pickingInput || frameEditor.isOpen() || $("trim-editor").open || (needsIdle && batch)) return;
  pickingInput = true;
  renderInputActions();
  try {
    const paths = await pick();
    if (paths.length && !(needsIdle && batch)) accept(paths);
  } catch (error) {
    setStatus(errorMessage(error), "error");
  } finally {
    pickingInput = false;
    renderInputActions();
  }
}

function browse() {
  return pickAtEntry(() => invoke("choose_inputs", { title: t("pickFiles"), filter: t("imageVideo") }), addPaths);
}

function browseVideo() {
  return pickAtEntry(() => invoke("choose_inputs", {
    title: t("videoToAnimation"), filter: t("videoFiles"), media: "videos", single: true,
  }), paths => addPaths(paths, { trimVideo: true }), true);
}

function updateDestinationActions() {
  $("reset-destination").hidden = !destination;
  $("open-destination").disabled = !destination && !selected;
}

function setDestination(path) {
  destination = path;
  setText("destination-label", path ? basename(path) : message("defaultFolder"));
  $("destination").title = path || "";
  updateDestinationActions();
  renderQueue();
}

async function startOrStop(event) {
  event.preventDefault();
  if (batch) {
    const job = batch;
    job.stopping = true;
    renderQueue();
    try {
      await invoke("cancel", { jobId: job.id });
    } catch (error) {
      setStatus(errorMessage(error), "error");
    }
    return;
  }
  if (!files.length) return;
  const settings = exportSettings();
  const { queued } = planExports(files, settings);
  const job = { id: ++nextJob, stopping: false, index: 0, total: queued.length };
  batch = job;
  batchReport = null;
  renderQueue();
  let ok = 0;
  let failed = 0;
  let missed = 0;
  let capped = 0;
  let recovered = 0;
  for (const file of queued) {
    if (job.stopping) break;
    job.index++;
    file.active = true;
    file.error = null;
    const previous = file.result;
    if (file === selected) {
      outcome(file);
      if (!previous || previewRequest?.file === file) refreshResult(file);
    }
    const row = queueRows.get(file.id);
    syncQueueStatus(row, file, settings, currentLanguage());
    renderExportAction(settings);
    try {
      if (file.videoError) throw new Error("ui:" + file.videoError);
      file.result = await invoke("convert", {
        jobId: job.id, path: file.path, ...settings,
        videoSettings: file.videoSettings, adjustment: file.adjustment, frameEdit: file.frameEdit,
      });
      file.exportSettings = settings;
      if (file.dependencyError) {
        file.dependencyError = null;
        if (file === selected) renderVideoNote(file);
      }
      if (file.result.videoSettings) file.videoSettings = file.result.videoSettings;
      if (file.result.targetMet === false) missed++;
      if (loopCapped(file.result)) capped++;
      if (file.result.source.recovered) recovered++;
      ok++;
    } catch (error) {
      if (errorText(error) !== "ui:cancelled") {
        file.error = errorMessage(error);
        if (file.video) {
          file.dependencyError = dependencyError(errorText(error));
          if (file === selected) renderVideoNote(file);
        }
        failed++;
      }
    } finally {
      file.active = false;
      if (file === selected) {
        outcome(file);
        if (!previous || file.result !== previous || previewRequest?.file === file) refreshResult(file);
      }
      syncQueueStatus(row, file, settings, currentLanguage());
    }
  }
  batch = null;
  batchReport = {
    text: [
      message(job.stopping ? "batchCancelled" : "batchDone"), message("batchSuccessCount", { count: ok }),
      failed && message("batchErrorCount", { count: failed }),
      missed && message("batchMissedCount", { count: missed }),
      capped && message("batchLoopCount", { count: capped }),
      recovered && message("batchGifRecovered", { count: recovered }),
    ],
    warning: Boolean(failed || missed || capped || recovered),
  };
  renderQueue();
}

for (const id of videoFields) {
  $(id).onchange = () => videoEdit();
}
for (const option of qualityOptions) $("quality-" + option).oninput = qualityEdit;
$("quality-apply-all").onclick = applyQualityToAll;
$("quality-reset").onclick = () => {
  if (editSelectedQuality(neutralQuality)) setStatus(message("qualityReset"));
};
const trimEditor = bindTrimEditor({
  invoke,
  nextId: () => ++nextPreviewId,
  setText,
  settings: editedVideoSettings,
  commit(file, range) {
    if (selected === file) videoEdit(0, range);
  },
});
const pickImages = single => invoke("choose_inputs", {
  title: t("frameImages"), filter: t("frameImages"), media: "images", single,
});
const frameEditor = bindFrameEditor({
  invoke, pickImages,
  commit(target, path, edit) {
    if (batch || (target && target !== selected)) return;
    const file = target || { id: ++nextFile, path, synthetic: true };
    file.frameEdit = edit;
    file.result = file.error = file.info = null;
    if (!target) {
      files.push(file);
      selectFile(file);
    } else {
      outcome(file);
      resetComparison(file);
      renderQueue();
    }
  },
});
$("create-animation").onclick = () => pickAtEntry(() => pickImages(false), paths => {
  if (paths.length > 600) return setStatus(message("frameEditorBudget"), "warning");
  pause();
  frameEditor.open({ paths });
}, true);
$("edit-frames").onclick = () => {
  const original = players.before.media;
  if (batch || !selected || selected.video || !original?.info.animated || original.sourceFile !== selected) return;
  pause();
  frameEditor.open({ target: selected, original });
};
function openClip(file) {
  if (!file?.videoInfo || file !== selected || batch || frameEditor.isOpen()) return;
  pause();
  const position = players.before.media?.sourceFile === file ? clock.position : 0;
  trimEditor.open(file, file.videoSettings.startMs + position);
}

$("edit-clip").onclick = () => openClip(selected);
$("add-files").onclick = browse;
$("video-to-animation").onclick = browseVideo;
$("empty-add").onclick = browse;
function renderUpdateState(state) {
  updateState = state;
  const { status, tag, retryAt } = state;
  const version = tag && "v" + tag.replace(/^v/, "");
  const hasUpdate = Boolean(tag);
  $("updates").hidden = !hasUpdate;
  $("open-update-page").hidden = !hasUpdate;
  if (hasUpdate) setText("update-badge", message("updateBadge", { version }));
  const states = { checking: "updateChecking", current: "updateCurrent", unpublished: "updateUnpublished", failed: "updateFailed" };
  let text = states[status] ? message(states[status]) : "";
  if (status === "available") text = message("updateAvailable", { version });
  if (status === "rateLimited") {
    const time = new Intl.DateTimeFormat(currentLanguage(), { dateStyle: "short", timeStyle: "short" }).format(retryAt);
    text = message("updateRateLimited", { time });
  }
  setText("update-state", text);
}

async function showUpdateDialog(manual) {
  setText("update-error", "");
  const dialog = $("update-dialog");
  if (!dialog.open) dialog.showModal();
  if (manual) setText("update-state", message("updateChecking"));
  const checker = await updateCheckerReady;
  if (!checker) {
    setText("update-state", message("updateFailed"));
  } else if (manual) {
    await checker.check(true);
    // A background check may already be in progress.
    renderUpdateState(updateState);
  } else {
    checker.showAvailable();
  }
}

$("updates").onclick = () => showUpdateDialog(false);
$("open-update-page").onclick = async () => {
  const tag = updateState?.tag;
  if (!tag) return;
  try {
    await invoke("open_update_page", { tag });
  } catch (error) {
    setText("update-error", errorMessage(error));
  }
};
$("clear").onclick = () => {
  if (batch) return;
  files.length = 0;
  batchReport = null;
  selectFile(null);
  $("add-files").focus();
};
$("queue").onkeydown = event => {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey ||
      !event.target.classList.contains("queue-select")) return;
  const index = files.findIndex(file => String(file.id) === event.target.dataset.fileId);
  const next = { ArrowUp: index - 1, ArrowDown: index + 1, Home: 0, End: files.length - 1 }[event.key];
  if (next === undefined) return;
  event.preventDefault();
  const file = files[Math.max(0, Math.min(files.length - 1, next))];
  if (!file) return;
  selectFile(file);
  queueRows.get(file.id).select.focus();
};
$("settings").onsubmit = startOrStop;
$("output-format").onchange = () => renderQueue();
$("mode").onchange = () => {
  const visible = $("mode").value === "target";
  $("target-field").hidden = !visible;
  $("target").required = visible;
  renderQueue();
};
$("target").max = Math.floor(fileLimitBytes / bytesPerKB);
$("target").oninput = () => renderQueue();
const qualityPanel = $("quality-settings");
try { qualityPanel.open = localStorage.getItem("any2webp-quality-panel") === "open"; } catch {}
qualityPanel.addEventListener("toggle", () => {
  try { localStorage.setItem("any2webp-quality-panel", qualityPanel.open ? "open" : "closed"); } catch {}
});
$("destination").onclick = async () => {
  try {
    const path = await invoke("choose_output", { title: t("saveTo") });
    if (path && !batch) setDestination(path);
  } catch (error) {
    setStatus(errorMessage(error), "error");
  }
};
$("reset-destination").onclick = () => setDestination(null);
$("open-destination").onclick = async () => {
  try {
    await invoke("open_output_folder", { destination, source: selected?.path ?? null });
  } catch (error) {
    setStatus(errorMessage(error), "error");
  }
};
$("reveal").onclick = async () => {
  if (!selected?.result) return;
  try {
    await invoke("reveal", { path: selected.result.path });
  } catch (error) {
    setStatus(errorMessage(error), "error");
  }
};

const showVideoDependencies = bindVideoDependencies(invoke, setText, () => {
  const needsPreview = Boolean(selected?.dependencyError);
  let changed = false;
  for (const file of files) {
    if (!file.dependencyError) continue;
    file.dependencyError = null;
    if (dependencyError(file.error)) file.error = null;
    changed = true;
  }
  if (!changed) return;
  if (needsPreview) {
    outcome(selected);
    renderVideoNote(selected);
    resetComparison(selected, { refreshVideo: true });
  }
  renderQueue();
});
$("video-dependency").onclick = showVideoDependencies;

$("play").onclick = () => {
  const source = players.before.media;
  if (!source?.duration) return;
  if (started !== null) {
    pause();
    return;
  }
  if (source.info.plays && elapsed >= source.duration * source.info.plays) elapsed = 0;
  started = performance.now();
  playbackButtons();
  raf = requestAnimationFrame(tick);
};
$("scrub").oninput = () => seek(Number($("scrub").value));
function step(amount) {
  const source = players.before.media;
  if (!source) return;
  const index = frameAt(source.starts, clock.position);
  seek(source.starts[Math.max(0, Math.min(source.count - 1, index + amount))]);
}
$("previous-frame").onclick = () => step(-1);
$("next-frame").onclick = () => step(1);

webview.getCurrentWebview().onDragDropEvent(({ payload }) => {
  document.body.classList.toggle("dragging", payload.type === "enter" || payload.type === "over");
  if (payload.type === "drop") addPaths(payload.paths);
}).catch((error) => setStatus(errorMessage(error), "error"));

const menuEventsReady = appEvents.listen("app-menu-action", ({ payload }) => {
  if (payload === "add-files") browse();
  else if (payload === "check-updates") showUpdateDialog(true);
  else if (payload === "video-dependencies") showVideoDependencies();
  else refreshLanguage(payload, true);
});
window.addEventListener("languagechange", updateSystemLanguage);
window.addEventListener("focus", updateSystemLanguage);
setText("before-title", message("original"));
setText("after-title", message("converted"));
setText("before-message", message("loadingImage"));
setText("after-message", message("noResult"));
setDestination(null);
outcome(null);
refreshLanguage(savedLanguage());
updateSystemLanguage();
loadAdjustment().catch(console.warn);
const updateCheckerReady = tauriApp.getVersion().then(version => {
  $("app-version").textContent = "v" + version;
  $("app-version").hidden = false;
  setText("update-version", message("installedVersion", { version: "v" + version }));
  $("update-version").hidden = false;
  const checker = createUpdateChecker({
    installed: version,
    query: () => invoke("check_for_updates"),
    onChange: renderUpdateState,
    storage: {
      getItem: key => localStorage.getItem(key),
      setItem: (key, value) => localStorage.setItem(key, value),
    },
  });
  setTimeout(() => {
    checker.checkAtLaunch();
    window.addEventListener("focus", () => checker.check());
  }, 800);
  setInterval(() => checker.check(), 15 * 60 * 1000);
  return checker;
}).catch(error => {
  console.warn(error);
  return null;
});
