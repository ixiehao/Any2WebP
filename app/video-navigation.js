export function readVideoFrames(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes.length < 12) throw new Error("ui:invalidNavigation");
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = header.getUint32(0, true);
  const height = header.getUint32(4, true);
  const count = header.getUint32(8, true);
  const stride = width * height * 4;
  if (!width || !height || width > 480 || height > 480 ||
      count < 1 || count > 8 || bytes.length !== 12 + stride * count) {
    throw new Error("ui:invalidNavigation");
  }
  return {
    width, height, count,
    image(index) {
      return new ImageData(
        new Uint8ClampedArray(bytes.buffer, bytes.byteOffset + 12 + stride * index, stride),
        width, height,
      );
    },
  };
}

export function filmstripIndex(position, range, count) {
  const fraction = (position - range.startMs) / (range.endMs - range.startMs);
  return Math.max(0, Math.min(count - 1, Math.floor(fraction * count)));
}

export function paintFilmstrip(container, frames) {
  const tiles = document.createDocumentFragment();
  for (let index = 0; index < frames.count; index++) {
    const tile = document.createElement("canvas");
    tile.width = frames.width;
    tile.height = frames.height;
    tile.getContext("2d").putImageData(frames.image(index), 0, 0);
    tiles.append(tile);
  }
  container.replaceChildren(tiles);
}

// Keep at most one FFmpeg seek in flight and replace the waiting seek on every move.
export function createVideoReader(invoke, nextId, single) {
  let pending = null;
  let activeId = null;
  let generation = 0;
  let busy = false;
  let lastStart = -Infinity;

  async function pump() {
    if (busy) return;
    busy = true;
    while (pending) {
      const delay = (single ? 65 : 0) - (performance.now() - lastStart);
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
      if (!pending) break;
      const { path, position, show, fail, revision } = pending;
      pending = null;
      const requestId = nextId();
      activeId = requestId;
      lastStart = performance.now();
      try {
        const data = await invoke("video_navigation", { requestId, path, ...position });
        if (revision === generation) show(readVideoFrames(data));
      } catch (error) {
        if (revision === generation) fail?.(error);
      } finally {
        activeId = null;
      }
    }
    busy = false;
  }

  return {
    request(path, position, show, fail) {
      pending = { path, position, show, fail, revision: generation };
      void pump();
    },
    cancel() {
      generation++;
      pending = null;
      if (activeId !== null) {
        invoke("cancel_video_navigation", { requestId: activeId, single }).catch(() => {});
      }
    },
  };
}
