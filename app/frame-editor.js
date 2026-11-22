import { errorMessage, message, messageText, t } from "./i18n.js";
import { readPreview } from "./timeline.js";
import { frameBudgetBytes, sizeText } from "./byte-size.js";
import { basename } from "./path.js";

const maxFrames = 600;
const maxDelay = 0xffffff;

export function sortFramePaths(paths) {
  const order = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  return [...paths].sort((a, b) => order.compare(basename(a), basename(b)) || order.compare(a, b));
}

export function delayAt(index, fps) {
  return Math.round((index + 1) * 1000 / fps) - Math.round(index * 1000 / fps);
}

export function frameBudget(width, height, count) {
  const bytes = width * height * 4 * count;
  return { bytes, fits: width > 0 && height > 0 && count >= 2 && count <= maxFrames && bytes <= frameBudgetBytes };
}

export function sameFrameEdit(left, right) {
  return left.width === right.width && left.height === right.height && left.plays === right.plays &&
    left.frames.length === right.frames.length && left.frames.every((frame, i) => {
      const other = right.frames[i];
      return frame.path === other.path && frame.index === other.index && frame.delay === other.delay;
    });
}

function framePlan({ width, height, plays, frames }) {
  return { width, height, plays, frames: frames.map(({ path, index, delay }) => ({ path, index, delay })) };
}

export function bindFrameEditor({ invoke, pickImages, commit }) {
  const el = id => document.getElementById(id);
  const dialog = el("frame-editor"), strip = el("frame-strip"), stage = el("frame-stage"), delay = el("frame-delay");
  const scratch = document.createElement("canvas");
  const scratchContext = scratch.getContext("2d");
  let draft = null;
  let dragging = null;
  let viewRequest = 0;
  let nextView = null;
  let viewLoading = false;
  let shown = null;

  function paint(canvas, image, width, height) {
    const context = canvas.getContext("2d");
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (!image || !width || !height) return;
    scratch.width = image.width;
    scratch.height = image.height;
    scratchContext.putImageData(image, 0, 0);
    const scale = Math.min(canvas.width / width, canvas.height / height);
    const fit = Math.min(width / image.width, height / image.height) * scale;
    const drawnWidth = Math.max(1, Math.round(image.width * fit));
    const drawnHeight = Math.max(1, Math.round(image.height * fit));
    context.drawImage(scratch, Math.floor((canvas.width - drawnWidth) / 2),
      Math.floor((canvas.height - drawnHeight) / 2), drawnWidth, drawnHeight);
  }

  async function loadStill(frame) {
    const media = readPreview(await invoke("frame_asset", { path: frame.path }));
    if (media.info.animated) throw new Error("ui:frameUseStill");
    return media;
  }

  function imageFor(frame) {
    if (frame?.original) return frame.original.image(frame.originalIndex);
    return frame?.thumbnail || null;
  }

  async function loadSelected() {
    if (viewLoading) return;
    viewLoading = true;
    while (nextView) {
      const { request, frame, state } = nextView;
      nextView = null;
      try {
        const media = await loadStill(frame);
        if (viewRequest === request && draft === state) {
          paint(stage, media.image(0), state.width, state.height);
        }
      } catch { /* Keep the available thumbnail if a later preview read fails. */ }
    }
    viewLoading = false;
  }

  function selection(scroll = false, loadedImage = null) {
    if (!draft) return;
    const state = draft, frame = state.selected;
    if (shown?.frame !== frame) {
      if (shown) {
        shown.frame.button.setAttribute("aria-pressed", "false");
        shown.frame.button.tabIndex = -1;
      }
      frame.button.setAttribute("aria-pressed", "true");
      frame.button.tabIndex = 0;
    }
    if (scroll) frame?.button.scrollIntoView({ block: "nearest", inline: "nearest" });
    delay.value = frame?.delay ?? "";
    if (loadedImage || shown?.frame !== frame || shown.width !== state.width || shown.height !== state.height) {
      shown = { frame, width: state.width, height: state.height };
      const request = ++viewRequest;
      nextView = null;
      const scale = Math.min(1, 510 / Math.max(1, state.width, state.height));
      stage.width = Math.max(1, Math.round(state.width * scale));
      stage.height = Math.max(1, Math.round(state.height * scale));
      paint(stage, loadedImage || imageFor(frame), state.width, state.height);
      if (!loadedImage && frame.thumbnail && !frame.original) {
        nextView = { request, frame, state };
        loadSelected();
      }
    }
    controls();
  }

  function controls() {
    const state = draft;
    if (!state) return;
    const count = state.frames.length, selectedIndex = state.frames.indexOf(state.selected);
    const { bytes, fits } = frameBudget(state.width, state.height, count);
    const seconds = state.frames.reduce((total, frame) => total + frame.delay, 0) / 1000;
    el("frame-editor-total").textContent = t("frameTotal", { count, seconds: Number(seconds.toFixed(3)) });
    el("frame-editor-budget").textContent = state.width ? t("frameBudget", {
      width: state.width, height: state.height, memory: sizeText(bytes),
    }) : t("loadingImage");
    el("frame-editor-budget").classList.toggle("warning", Boolean(state.width) && !fits);
    const broken = state.frames.find(frame => frame.error);
    const error = state.error || (broken && [basename(broken.path), broken.error]) ||
      (count < 2 ? message("frameNeedTwo") : !fits && state.width ? message("frameEditorBudget") : null);
    el("frame-editor-error").textContent = messageText(error);
    el("frame-editor-error").hidden = !error;
    el("frame-apply").disabled = !fits || state.busy || Boolean(broken);
    el("frame-insert").disabled = state.busy || count >= maxFrames;
    el("frame-replace").disabled = state.busy || !state.selected;
    el("frame-delete").disabled = count <= 1 || state.busy;
    el("frame-left").disabled = selectedIndex <= 0;
    el("frame-right").disabled = selectedIndex >= count - 1;
    delay.disabled = !state.selected;
  }

  function captions() {
    draft.frames.forEach((frame, index) => {
      frame.caption.textContent = (index + 1) + " · " + frame.delay + " ms";
    });
  }

  function repaint() {
    captions();
    strip.replaceChildren(...draft.frames.map(frame => frame.button));
    selection();
  }

  function move(frame, to) {
    const state = draft, from = state.frames.indexOf(frame);
    if (from < 0 || from === to || to < 0 || to >= state.frames.length) return;
    state.frames.splice(from, 1);
    state.frames.splice(to, 0, frame);
    state.selected = frame;
    strip.insertBefore(frame.button, state.frames[to + 1]?.button ?? null);
    captions();
    selection(true);
    frame.button.focus({ preventScroll: true });
  }

  function newFrame(path, index, duration, original = null, originalIndex = index) {
    const button = document.createElement("button"), thumb = document.createElement("canvas");
    const caption = document.createElement("span");
    const frame = { path, index, delay: duration, original, originalIndex, button, thumb, caption };
    button.className = "frame-thumb";
    button.type = "button";
    button.draggable = true;
    button.title = basename(path);
    button.tabIndex = -1;
    button.setAttribute("aria-pressed", "false");
    thumb.width = 88;
    thumb.height = 54;
    thumb.className = "checker";
    button.append(thumb, caption);
    button.onclick = () => { draft.selected = frame; selection(true); };
    button.ondragstart = event => {
      dragging = frame;
      event.dataTransfer.setData("text/plain", String(draft.frames.indexOf(frame)));
      event.dataTransfer.effectAllowed = "move";
    };
    button.ondragover = event => {
      if (!dragging || dragging === frame) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      const rect = button.getBoundingClientRect();
      button.dataset.drop = event.clientX < rect.left + rect.width / 2 ? "before" : "after";
    };
    button.ondragleave = () => { delete button.dataset.drop; };
    button.ondrop = event => {
      if (!dragging || dragging === frame || !button.dataset.drop) return;
      event.preventDefault();
      const index = draft.frames.indexOf(frame), from = draft.frames.indexOf(dragging);
      const to = index + Number(button.dataset.drop === "after") - Number(from < index);
      delete button.dataset.drop;
      move(dragging, to);
    };
    button.ondragend = () => {
      dragging = null;
      for (const item of strip.children) delete item.dataset.drop;
    };
    if (original) paint(thumb, original.image(originalIndex), draft.width, draft.height);
    return frame;
  }

  function showStill(state, frame, media) {
    const newCanvas = !state.width;
    if (newCanvas) ({ width: state.width, height: state.height } = media.info);
    const image = media.image(0);
    const thumb = document.createElement("canvas");
    const scale = Math.min(1, 100 / Math.max(image.width, image.height));
    thumb.width = Math.max(1, Math.round(image.width * scale));
    thumb.height = Math.max(1, Math.round(image.height * scale));
    paint(thumb, image, image.width, image.height);
    frame.thumbnail = thumb.getContext("2d").getImageData(0, 0, thumb.width, thumb.height);
    paint(frame.thumb, image, state.width, state.height);
    if (frame === state.selected) selection(false, image);
    else if (newCanvas) selection();
  }

  async function validateStills(state, frames) {
    let displayedError = false;
    for (const frame of frames) {
      if (draft !== state) break;
      try {
        const media = await loadStill(frame);
        if (draft !== state) break;
        showStill(state, frame, media);
      } catch (error) {
        frame.error = errorMessage(error);
        if (draft === state && !displayedError) {
          displayedError = true;
          controls();
        }
      }
    }
    if (draft === state) {
      state.busy = false;
      controls();
    }
  }

  async function choose(replace = false) {
    const state = draft, selected = state?.selected;
    if (!state || state.busy) return;
    state.busy = true;
    state.error = null;
    controls();
    let replacingPath;
    try {
      const paths = sortFramePaths(await pickImages(replace));
      if (draft !== state || !paths.length) return;
      const added = replace ? paths.slice(0, 1) : paths;
      if (state.frames.length + added.length - Number(replace) > maxFrames) {
        state.error = message("frameEditorBudget");
        return;
      }
      if (replace) {
        replacingPath = added[0];
        const frame = newFrame(replacingPath, 0, selected.delay);
        const media = await loadStill(frame);
        if (draft !== state) return;
        frame.delay = selected.delay;
        state.frames[state.frames.indexOf(selected)] = frame;
        state.selected = frame;
        captions();
        selected.button.replaceWith(frame.button);
        showStill(state, frame, media);
        return;
      }
      const frames = added.map((path, i) => newFrame(path, 0, delayAt(i, state.fps)));
      state.frames.splice(state.frames.indexOf(selected) + 1, 0, ...frames);
      state.selected = frames[0];
      repaint();
      await validateStills(state, frames);
    } catch (error) {
      state.error = replacingPath ? [basename(replacingPath), errorMessage(error)] : errorMessage(error);
    } finally {
      if (draft === state) {
        state.busy = false;
        controls();
      }
    }
  }

  function open({ target, original, paths }) {
    const existing = target?.frameEdit;
    const state = {
      target, anchor: target?.path || paths[0], width: original?.info.width || 0, height: original?.info.height || 0,
      plays: existing?.plays ?? original?.info.plays ?? 0, fps: 12, frames: [], selected: null, busy: !original,
    };
    draft = state;
    el("frame-fps").value = "12";
    if (original) {
      state.frames = original.info.delays.map((duration, i) => {
        const ref = existing?.frames[i];
        return newFrame(ref?.path || target.path, ref?.index ?? i, duration, original, i);
      });
    } else {
      state.frames = sortFramePaths(paths).map((path, i) => newFrame(path, 0, delayAt(i, 12)));
      state.anchor = state.frames[0].path;
    }
    state.selected = state.frames[0];
    if (target) state.initial = framePlan(state);
    repaint();
    dialog.showModal();
    if (!original) validateStills(state, state.frames);
  }

  function close() {
    if (!draft) return;
    draft = null;
    shown = null;
    dragging = null;
    nextView = null;
    viewRequest++;
    strip.replaceChildren();
    stage.width = stage.height = 1;
    if (dialog.open) dialog.close();
  }

  strip.onkeydown = event => {
    if (!draft || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey ||
        event.target !== draft.selected.button) return;
    const current = draft.frames.indexOf(draft.selected), last = draft.frames.length - 1;
    const next = { ArrowLeft: current - 1, ArrowRight: current + 1, Home: 0, End: last }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    draft.selected = draft.frames[Math.max(0, Math.min(last, next))];
    selection(true);
    draft.selected.button.focus({ preventScroll: true });
  };

  el("frame-insert").onclick = () => choose();
  el("frame-replace").onclick = () => choose(true);
  el("frame-delete").onclick = () => {
    const index = draft.frames.indexOf(draft.selected);
    draft.frames.splice(index, 1);
    draft.selected = draft.frames[Math.min(index, draft.frames.length - 1)];
    draft.error = null;
    repaint();
  };
  el("frame-left").onclick = () => move(draft.selected, draft.frames.indexOf(draft.selected) - 1);
  el("frame-right").onclick = () => move(draft.selected, draft.frames.indexOf(draft.selected) + 1);
  el("frame-set-fps").onclick = () => {
    draft.fps = Number(el("frame-fps").value);
    draft.frames.forEach((frame, i) => { frame.delay = delayAt(i, draft.fps); });
    captions();
    selection();
  };
  delay.oninput = () => {
    const value = delay.valueAsNumber;
    if (draft?.selected && Number.isInteger(value) && value >= 0 && value <= maxDelay) {
      draft.selected.delay = value;
      draft.selected.caption.textContent = (draft.frames.indexOf(draft.selected) + 1) + " · " + value + " ms";
      controls();
    }
  };
  el("frame-apply").onclick = () => {
    if (!delay.value || !delay.reportValidity()) return;
    const { target, anchor, initial } = draft;
    const edit = framePlan(draft);
    close();
    if (!initial || !sameFrameEdit(edit, initial)) commit(target, anchor, edit);
  };
  el("frame-cancel").onclick = close;
  dialog.addEventListener("cancel", event => { event.preventDefault(); close(); });
  return { open, close, refresh: controls, isOpen: () => dialog.open };
}
