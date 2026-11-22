import { message, t } from "./i18n.js";
import { edgePanSpeed, frameAt, moveTrimRange, readPreview, timelineViewport,
  trimHandleLimits, trimPointerTime, zoomTimelineViewport } from "./timeline.js";
import { clipFromPlayhead, formatTimecode, MAX_VIDEO_FPS, minimumClipMs, parseTimecode,
  stepSourceFrame, videoClipLimits, videoSettingsError } from "./trim-time.js";
import { createVideoReader, filmstripIndex, paintFilmstrip } from "./video-navigation.js";
import { basename } from "./path.js";

const minimumPlaybackMs = minimumClipMs(MAX_VIDEO_FPS);

export function bindTrimEditor({ invoke, nextId, setText, settings, commit }) {
  const $ = id => document.getElementById(id);
  const dialog = $("trim-editor");
  const track = $("trim-track");
  const canvas = $("trim-preview");
  const context = canvas.getContext("2d");
  const fields = { start: $("trim-start-time"), end: $("trim-end-time") };
  const handles = { start: $("trim-start"), end: $("trim-end"), range: $("trim-selection") };
  const presets = [...dialog.querySelectorAll("[data-trim-ms]")];
  const moveEarlier = message("trimMovePlayheadBack");
  const strip = createVideoReader(invoke, nextId, false);
  const frame = createVideoReader(invoke, nextId, true);
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const fieldTime = (range, boundary) => range[boundary === "end" ? "endMs" : "startMs"];
  const secondsText = ms => (ms / 1000).toFixed(3).replace(/\.?0+$/, "");
  let session = null;
  let stripTimer = 0;
  let playbackQueue = Promise.resolve();

  function renderPosition() {
    const { position, duration, playback } = session;
    const slider = $("trim-playhead");
    slider.max = duration;
    slider.value = position;
    slider.setAttribute("aria-valuetext", formatTimecode(position));
    $("trim-play-position").textContent = formatTimecode(position, false);
    $("trim-play-duration").textContent = formatTimecode(duration, false);
    const control = $("trim-play");
    control.disabled = duration < minimumPlaybackMs;
    const action = t(playback ? "pause" : "play");
    control.setAttribute("aria-label", action);
    control.title = action;
    $("trim-play-symbol").setAttribute("href", playback ? "#pause-icon" : "#play-icon");
    $("trim-previous").disabled = position === 0;
    $("trim-next").disabled = position === duration;
    renderPresets();
  }

  function renderPresets() {
    const { clipLimits, position, duration, drag, presetNotice } = session;
    const canSelect = clipLimits && clipLimits.maxMs >= clipLimits.minMs;
    const tooCloseToEnd = canSelect && duration - position < clipLimits.minMs;
    const disabled = !canSelect || tooCloseToEnd || Boolean(drag);
    for (const button of presets) if (button.disabled !== disabled) button.disabled = disabled;
    const notice = tooCloseToEnd && !drag ? moveEarlier : (presetNotice ?? null);
    if (notice === session.visiblePresetNotice) return;
    session.visiblePresetNotice = notice;
    $("trim-preset-note").hidden = !notice;
    setText("trim-preset-note", notice);
  }

  function limits(boundary, range = session.range) {
    if (boundary === "range") return [0, session.duration - (range.endMs - range.startMs)];
    return trimHandleLimits(boundary, range, session.duration, session.outputFps);
  }

  function renderBounds(normalize = false) {
    const { range, viewport, duration, file, clipLimits } = session;
    const span = viewport.endMs - viewport.startMs;
    const fraction = time => clamp((time - viewport.startMs) / span, 0, 1);
    const selection = handles.range;
    selection.style.left = fraction(range.startMs) * 100 + "%";
    selection.style.right = (1 - fraction(range.endMs)) * 100 + "%";
    selection.hidden = range.endMs <= viewport.startMs || range.startMs >= viewport.endMs;
    selection.disabled = range.endMs - range.startMs === duration;
    for (const [boundary, handle] of Object.entries(handles)) {
      const time = fieldTime(range, boundary);
      const [min, max] = limits(boundary);
      if (boundary !== "range") {
        handle.style.left = fraction(time) * 100 + "%";
        handle.hidden = time < viewport.startMs || time > viewport.endMs;
      }
      handle.setAttribute("aria-valuemin", Math.min(time, min) / 1000);
      handle.setAttribute("aria-valuemax", Math.max(time, max) / 1000);
      handle.setAttribute("aria-valuenow", time / 1000);
      handle.setAttribute("aria-valuetext", boundary === "range"
        ? t("trimSummary", { start: formatTimecode(range.startMs), end: formatTimecode(range.endMs) })
        : formatTimecode(time));
    }
    for (const [boundary, input] of Object.entries(fields)) {
      const value = fieldTime(range, boundary);
      if (normalize) input.value = formatTimecode(value);
      input.setAttribute("aria-invalid", String(session.invalidField === boundary));
      for (const [direction, count] of [["back", -5], ["forward", 5]]) {
        $("trim-" + boundary + "-" + direction).disabled =
          stepSourceFrame(value, count, session.sourceFps, ...limits(boundary)) === value;
      }
    }
    setText("trim-original-duration", message("trimOriginalDuration", { duration: formatTimecode(duration) }));
    $("trim-duration").textContent = formatTimecode(range.endMs - range.startMs);
    const error = session.invalidField ? "trimInvalidTimecode" : videoSettingsError(file.videoInfo, settings(file, range));
    $("trim-error").hidden = !error;
    setText("trim-error", error === "maxFrames" && clipLimits
      ? message("trimMaxExceeded", { duration: secondsText(clipLimits.maxMs) })
      : error ? message(error) : null);
    $("trim-confirm").disabled = Boolean(error || session.drag);
    renderPresets();
    $("trim-zoom-in").disabled = span <= Math.min(1000, duration) || Boolean(session.drag);
    $("trim-zoom-out").disabled = $("trim-zoom-full").disabled = span === duration || Boolean(session.drag);
    const pan = $("trim-pan");
    pan.hidden = span === duration;
    pan.disabled = Boolean(session.drag);
    pan.max = duration - span;
    pan.value = viewport.startMs;
    [...$("trim-ticks").children].forEach((node, index) => {
      node.textContent = formatTimecode(viewport.startMs + span * index / 4, span < 5000);
    });
  }

  function paint(image) {
    if (canvas.width !== image.width) canvas.width = image.width;
    if (canvas.height !== image.height) canvas.height = image.height;
    context.putImageData(image, 0, 0);
    canvas.hidden = false;
    $("trim-preview-state").hidden = true;
  }

  function previewStatus(key) {
    setText("trim-preview-state", message(key));
    $("trim-preview-state").hidden = false;
  }

  function showFrame(value) {
    const current = session;
    current.position = clamp(Math.round(value), 0, current.duration);
    renderPosition();
    const sample = Math.min(current.position, current.duration - 1);
    if (current.frameWanted === sample) return;
    current.frameWanted = sample;
    if (current.thumbnails) {
      const { range, frames } = current.thumbnails;
      if (sample >= range.startMs && sample <= range.endMs) {
        const index = filmstripIndex(sample, range, frames.count);
        const nearby = range.startMs + (index + .5) * (range.endMs - range.startMs) / frames.count;
        if (canvas.hidden || Math.abs(sample - nearby) < Math.abs(sample - current.drawnAt)) {
          paint(frames.image(index));
          current.drawnAt = nearby;
        }
      }
    }
    frame.request(current.file.path, { timeMs: sample }, frames => {
      if (session !== current || current.frameWanted !== sample) return;
      paint(frames.image(0));
      current.drawnAt = sample;
    }, () => {
      if (session !== current || current.frameWanted !== sample) return;
      current.frameWanted = null;
      previewStatus("frameUnavailable");
    });
  }

  function loadStrip(delay = 0) {
    const current = session;
    const range = current.viewport;
    clearTimeout(stripTimer);
    strip.cancel();
    current.thumbnails = null;
    $("trim-filmstrip").replaceChildren();
    stripTimer = setTimeout(() => {
      strip.request(current.file.path, { range }, frames => {
        if (session !== current || current.viewport !== range) return;
        current.thumbnails = { range, frames };
        paintFilmstrip($("trim-filmstrip"), frames);
      });
    }, delay);
  }

  function setViewport(view) {
    if (view.startMs === session.viewport.startMs && view.endMs === session.viewport.endMs) return;
    session.viewport = view;
    renderBounds();
    loadStrip(100);
  }

  function zoom(factor, fraction = .5, anchor) {
    const { duration, viewport, position } = session;
    const time = anchor ?? clamp(position, viewport.startMs, viewport.endMs);
    setViewport(zoomTimelineViewport(duration, viewport, factor, time, fraction));
  }

  function revealTime(time) {
    const { viewport, duration } = session;
    if (time < viewport.startMs || time > viewport.endMs) {
      const span = viewport.endMs - viewport.startMs;
      setViewport(timelineViewport(duration, time - span / 2, span));
    }
  }

  function stopPlayback() {
    if (!session?.playback) return;
    const playback = session.playback;
    session.playback = null;
    cancelAnimationFrame(playback.raf);
    playback.finishFrame?.();
    if (playback.requestId !== null) {
      invoke("cancel_trim_playback", { requestId: playback.requestId }).catch(() => {});
    }
    renderPosition();
  }

  function fetchChunk(current, playback, position) {
    const startMs = Math.min(position, current.duration - minimumPlaybackMs);
    const endMs = Math.min(current.duration, startMs + 2000);
    const work = playbackQueue.then(async () => {
      if (session !== current || current.playback !== playback) return null;
      const requestId = nextId();
      playback.requestId = requestId;
      try {
        const media = readPreview(await invoke("trim_playback", { requestId, path: current.file.path, startMs, endMs }));
        return { startMs, endMs, media };
      } catch {
        return null;
      } finally {
        playback.requestId = null;
      }
    });
    playbackQueue = work;
    return work;
  }

  async function play() {
    const current = session;
    if (current.playback) {
      stopPlayback();
      showFrame(current.position);
      return;
    }
    if (current.duration < minimumPlaybackMs) return;
    frame.cancel();
    current.frameWanted = null;
    const playback = { requestId: null, raf: 0 };
    current.playback = playback;
    const active = () => session === current && current.playback === playback;
    let position = current.position >= current.duration ? 0 : current.position;
    renderPosition();
    let loading = fetchChunk(current, playback, position);
    while (active()) {
      const chunk = await loading;
      if (!active()) return;
      if (!chunk) {
        stopPlayback();
        previewStatus("frameUnavailable");
        return;
      }
      if (chunk.endMs < current.duration) loading = fetchChunk(current, playback, chunk.endMs);
      const origin = performance.now() - (position - chunk.startMs);
      let drawn = -1;
      let clockUpdate = -Infinity;
      await new Promise(resolve => {
        playback.finishFrame = resolve;
        function tick(now) {
          if (!active()) return resolve();
          position = clamp(Math.floor(now - origin) + chunk.startMs, chunk.startMs, chunk.endMs);
          const index = frameAt(chunk.media.starts, position - chunk.startMs);
          if (index !== drawn) {
            paint(chunk.media.image(index));
            drawn = index;
            current.drawnAt = chunk.startMs + chunk.media.starts[index];
          }
          current.position = position;
          if (position === chunk.endMs || now - clockUpdate >= 32) {
            renderPosition();
            clockUpdate = now;
          }
          if (position === chunk.endMs) resolve();
          else playback.raf = requestAnimationFrame(tick);
        }
        tick(performance.now());
      });
      playback.finishFrame = null;
      if (position === current.duration && active()) {
        stopPlayback();
        return;
      }
    }
  }

  function seek(time) {
    stopPlayback();
    showFrame(time);
  }

  function updateRange(range, time, reveal = false, presetNotice = null) {
    session.invalidField = null;
    session.range = range;
    session.presetNotice = presetNotice;
    if (reveal) revealTime(time);
    renderBounds(true);
    seek(time);
  }

  function moveBoundary(boundary, value, range = session.range) {
    const time = clamp(value, ...limits(boundary, range));
    const next = boundary === "range" ? moveTrimRange(range, time - range.startMs, session.duration)
      : { ...range, [boundary === "end" ? "endMs" : "startMs"]: time };
    return { time, next };
  }

  function applyText(boundary) {
    session.presetNotice = null;
    const startMs = parseTimecode(fields.start.value);
    const endMs = parseTimecode(fields.end.value);
    const next = { startMs, endMs };
    session.invalidField = startMs === null ? "start" : endMs === null ? "end" : null;
    const error = session.invalidField || videoSettingsError(session.file.videoInfo, settings(session.file, next));
    if (!session.invalidField && (error === "invalidTrim" || error === "minFrames")) session.invalidField = boundary;
    if (!session.invalidField) {
      session.range = next;
      const time = fieldTime(next, boundary);
      revealTime(time);
      seek(time);
    }
    renderBounds();
  }

  function startDrag(event, boundary) {
    if (!session || event.button !== 0 || session.drag) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    const { range, viewport } = session;
    session.drag = { boundary, range, viewport, origin: event.clientX,
      pointer: event.clientX, id: event.pointerId, handle: event.currentTarget, raf: 0 };
    renderBounds();
    seek(fieldTime(range, boundary));
  }

  function dragPosition() {
    const { drag, viewport } = session;
    const box = track.getBoundingClientRect();
    const span = viewport.endMs - viewport.startMs;
    const raw = trimPointerTime(fieldTime(drag.range, drag.boundary) + viewport.startMs - drag.viewport.startMs,
      drag.pointer - drag.origin, box.width, span);
    const time = drag.boundary === "range" ? raw : clamp(raw, viewport.startMs, viewport.endMs);
    const { next, time: actual } = moveBoundary(drag.boundary, time, drag.range);
    updateRange(next, actual);
  }

  function panDrag(now) {
    if (!session?.drag) return;
    const drag = session.drag;
    const box = track.getBoundingClientRect();
    const over = drag.pointer - box.left;
    const span = session.viewport.endMs - session.viewport.startMs;
    const width = box.width;
    const rate = edgePanSpeed(over, width, span);
    if (!rate || (rate < 0 && session.viewport.startMs === 0) ||
        (rate > 0 && session.viewport.endMs === session.duration)) {
      drag.raf = 0;
      drag.at = null;
      drag.pan = null;
      return;
    }
    const seconds = drag.at == null ? 0 : Math.min(.05, (now - drag.at) / 1000);
    drag.at = now;
    drag.pan ??= session.viewport.startMs;
    drag.pan = clamp(drag.pan + seconds * rate, 0, session.duration - span);
    const next = timelineViewport(session.duration, drag.pan, span);
    if (next.startMs !== session.viewport.startMs) {
      session.viewport = next;
      drag.panned = true;
      dragPosition();
    }
    drag.raf = requestAnimationFrame(panDrag);
  }

  function finishDrag(restore = false) {
    const drag = session?.drag;
    if (!drag) return;
    session.drag = null;
    cancelAnimationFrame(drag.raf);
    if (drag.handle.hasPointerCapture(drag.id)) drag.handle.releasePointerCapture(drag.id);
    if (restore) {
      session.viewport = drag.viewport;
      updateRange(drag.range, fieldTime(drag.range, drag.boundary));
    }
    renderBounds();
    if (drag.panned) loadStrip(80);
  }

  function close() {
    if (!session) return;
    stopPlayback();
    const drag = session.drag;
    session = null;
    if (drag) {
      cancelAnimationFrame(drag.raf);
      if (drag.handle.hasPointerCapture(drag.id)) drag.handle.releasePointerCapture(drag.id);
    }
    clearTimeout(stripTimer);
    frame.cancel();
    strip.cancel();
    canvas.width = canvas.height = 1;
    canvas.hidden = true;
    $("trim-filmstrip").replaceChildren();
    if (dialog.open) dialog.close();
  }

  for (const [boundary, handle] of Object.entries(handles)) {
    handle.onpointerdown = event => startDrag(event, boundary);
    handle.onkeydown = event => {
      if (!session || session.drag) return;
      const count = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1, PageUp: 5, PageDown: -5 }[event.key];
      if (!count && event.key !== "Home" && event.key !== "End") return;
      event.preventDefault();
      const [min, max] = limits(boundary);
      const value = event.key === "Home" ? min : event.key === "End" ? max
        : stepSourceFrame(fieldTime(session.range, boundary), count * (event.shiftKey ? 5 : 1), session.sourceFps, min, max);
      const { next, time } = moveBoundary(boundary, value);
      updateRange(next, time, true);
    };
  }
  track.onpointermove = event => {
    const drag = session?.drag;
    if (event.pointerId !== drag?.id || drag.pointer === event.clientX) return;
    drag.pointer = event.clientX;
    dragPosition();
    if (!drag.raf) drag.raf = requestAnimationFrame(panDrag);
  };
  track.onpointerup = event => {
    if (event.pointerId === session?.drag?.id) {
      if (session.drag.pointer !== event.clientX) {
        session.drag.pointer = event.clientX;
        dragPosition();
      }
      finishDrag();
    } else if (session && event.button === 0 && !event.target.closest("button")) {
      const box = track.getBoundingClientRect();
      const view = session.viewport;
      seek(trimPointerTime(view.startMs, event.clientX - box.left, box.width, view.endMs - view.startMs));
    }
  };
  track.onpointercancel = event => { if (event.pointerId === session?.drag?.id) finishDrag(true); };
  track.addEventListener("lostpointercapture", event => { if (event.pointerId === session?.drag?.id) finishDrag(true); });
  $("trim-zoom-in").onclick = () => zoom(.5);
  $("trim-zoom-out").onclick = () => zoom(2);
  $("trim-zoom-full").onclick = () => setViewport(timelineViewport(session.duration));
  $("trim-pan").oninput = event => setViewport(timelineViewport(session.duration, Number(event.target.value),
    session.viewport.endMs - session.viewport.startMs));
  track.addEventListener("wheel", event => {
    if (!session || session.drag) return;
    const { viewport, duration } = session;
    const span = viewport.endMs - viewport.startMs;
    const box = track.getBoundingClientRect();
    if ((event.metaKey || event.ctrlKey) && event.deltaY) {
      event.preventDefault();
      const fraction = clamp((event.clientX - box.left) / box.width, 0, 1);
      zoom(Math.exp(clamp(event.deltaY, -180, 180) / 145), fraction, viewport.startMs + span * fraction);
    } else {
      const distance = event.deltaX || (event.shiftKey ? event.deltaY : 0);
      if (!distance || span === duration) return;
      event.preventDefault();
      setViewport(timelineViewport(duration, viewport.startMs + distance * span / box.width, span));
    }
  }, { passive: false });

  for (const [boundary, input] of Object.entries(fields)) {
    input.oninput = () => applyText(boundary);
    input.onchange = () => { if (!session.invalidField) renderBounds(true); };
    input.onkeydown = event => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      applyText(boundary);
      if (!session.invalidField) renderBounds(true);
    };
    for (const [direction, offset] of [["back", -5], ["forward", 5]]) {
      $("trim-" + boundary + "-" + direction).onclick = () => {
        const value = stepSourceFrame(fieldTime(session.range, boundary), offset, session.sourceFps, ...limits(boundary));
        const { next, time } = moveBoundary(boundary, value);
        updateRange(next, time, true);
      };
    }
  }
  $("trim-playhead").oninput = event => seek(Number(event.target.value));
  $("trim-play").onclick = () => void play();
  for (const button of presets) {
    button.onclick = () => {
      if (!session || session.drag) return;
      const { position, duration, clipLimits, viewport } = session;
      const requested = Number(button.dataset.trimMs);
      const range = clipFromPlayhead(position, requested, duration, clipLimits);
      if (!range) return;
      const length = range.endMs - range.startMs;
      const notice = length < requested ? message(range.endMs === duration ? "trimPresetAtEnd" : "trimPresetLimited",
        { duration: secondsText(length) }) : null;
      if (range.startMs < viewport.startMs || range.endMs > viewport.endMs) {
        const span = Math.max(viewport.endMs - viewport.startMs, length);
        setViewport(timelineViewport(duration, range.startMs - (span - length) / 2, span));
      }
      updateRange(range, position, false, notice);
    };
  }
  for (const [id, count] of [["trim-previous", -1], ["trim-next", 1]]) {
    $(id).onclick = () => seek(stepSourceFrame(session.position, count, session.sourceFps, 0, session.duration));
  }
  $("trim-cancel").onclick = close;
  dialog.oncancel = event => {
    event.preventDefault();
    if (session?.drag) finishDrag(true);
    else close();
  };
  $("trim-editor-form").onsubmit = event => {
    event.preventDefault();
    if (!session || $("trim-confirm").disabled) return;
    const { file, range } = session;
    close();
    commit(file, range);
  };
  return {
    open(file, playhead = file.videoSettings.startMs) {
      if (session) return;
      const duration = file.videoInfo.durationMs;
      const current = file.videoSettings;
      const fps = settings(file).fps;
      const outputFps = Number.isInteger(fps) && fps >= 1 && fps <= MAX_VIDEO_FPS ? fps : current.fps;
      const minimum = Math.min(duration, minimumClipMs(outputFps));
      const startMs = clamp(current.startMs, 0, duration - minimum);
      const endMs = clamp(current.endMs, startMs + minimum, duration);
      const position = clamp(Math.round(playhead), 0, duration);
      const clipLimits = videoClipLimits(file.videoInfo, settings(file));
      session = { file, duration, outputFps, sourceFps: file.videoInfo.sourceFps || 30,
        clipLimits, range: { startMs, endMs }, position, viewport: timelineViewport(duration) };
      const name = $("trim-file-name");
      name.textContent = basename(file.path);
      name.title = file.path;
      dialog.showModal();
      $("trim-limit").hidden = !clipLimits || clipLimits.maxMs < clipLimits.minMs;
      setText("trim-limit", clipLimits ? message("trimMaxDuration", {
        duration: secondsText(clipLimits.maxMs),
      }) : null);
      $("trim-play").focus();
      previewStatus("loadingFrame");
      renderBounds(true);
      loadStrip();
      showFrame(position);
    },
    close,
    refresh() {
      if (!session) return;
      renderBounds();
      renderPosition();
    },
  };
}
