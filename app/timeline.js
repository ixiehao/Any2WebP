import { minimumClipMs } from "./trim-time.js";

export function readPreview(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes.byteLength < 40) throw new Error("ui:invalidPreview");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const value = (index) => view.getUint32(index * 4, true);
  const [width, height, count, plays, flags, sourceWidth, sourceHeight, alpha, , sourceBytes] =
    Array.from({ length: 10 }, (_, index) => value(index));
  const format = new TextDecoder().decode(bytes.subarray(32, 36)).replace(/\0+$/, "");
  const frameBytes = width * height * 4;
  const pixelStart = (10 + count) * 4;
  if (!width || !height || !count || bytes.length !== pixelStart + frameBytes * count) {
    throw new Error("ui:invalidPreview");
  }
  const delays = Array.from({ length: count }, (_, index) => value(10 + index));
  const animated = Boolean(flags & 1);
  let duration = 0;
  const starts = delays.map((delay) => {
    const start = duration;
    // A zero-delay file frame remains zero in the exported container.
    // The comparison gives it display time so it can be inspected.
    duration += animated ? delay || 100 : 0;
    return start;
  });
  return {
    info: { format, width: sourceWidth, height: sourceHeight,
      plays, animated, alpha: Boolean(alpha), recovered: Boolean(flags & 2), delays, bytes: sourceBytes },
    width, height, count, starts, duration,
    image(index) {
      return new ImageData(
        new Uint8ClampedArray(bytes.buffer, bytes.byteOffset + pixelStart + index * frameBytes, frameBytes),
        width, height,
      );
    },
  };
}

export function readStampedPreview(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const footer = bytes.length - 4;
  if (footer < 40) throw new Error("ui:invalidPreview");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const size = view.getUint32(footer, true);
  const start = footer - size;
  if (!size || start < 40) throw new Error("ui:missingRevision");
  const media = readPreview(bytes.subarray(0, start));
  media.revision = new TextDecoder().decode(bytes.subarray(start, footer));
  return media;
}

export function frameAt(starts, time) {
  let low = 0;
  let high = starts.length;
  while (low + 1 < high) {
    const middle = (low + high) >>> 1;
    if (starts[middle] <= time) low = middle;
    else high = middle;
  }
  return low;
}

export function playbackPosition(elapsed, duration, plays) {
  if (!duration) return { position: 0, finished: true };
  if (plays && elapsed >= duration * plays) return { position: duration, finished: true };
  return { position: elapsed % duration, finished: false };
}

export function trimHandleLimits(boundary, range, durationMs, fps) {
  // The second frame must start strictly before the end on WebP's millisecond grid.
  const minimum = minimumClipMs(fps);
  return boundary === "start"
    ? [0, Math.max(0, range.endMs - minimum)]
    : [Math.min(durationMs, range.startMs + minimum), durationMs];
}

export function trimPointerTime(initialMs, deltaX, trackWidth, durationMs) {
  return Math.round(initialMs + deltaX * durationMs / trackWidth);
}

export function moveTrimRange(range, offsetMs, durationMs) {
  const offset = Math.max(-range.startMs, Math.min(durationMs - range.endMs, offsetMs));
  return { startMs: range.startMs + offset, endMs: range.endMs + offset };
}

export function timelineViewport(durationMs, startMs = 0, spanMs = durationMs) {
  const span = Math.max(Math.min(1000, durationMs), Math.min(durationMs, Math.round(spanMs)));
  const start = Math.max(0, Math.min(durationMs - span, Math.round(startMs)));
  return { startMs: start, endMs: start + span };
}

export function zoomTimelineViewport(durationMs, view, factor, anchor, fraction = .5) {
  const span = timelineViewport(durationMs, 0, (view.endMs - view.startMs) * factor).endMs;
  return timelineViewport(durationMs, anchor - fraction * span, span);
}

export function timelineClock(timeMs) {
  const seconds = Math.floor(timeMs / 1000);
  const whole = Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0");
  return timeMs % 1000 ? whole + "." + String(timeMs % 1000).padStart(3, "0") : whole;
}

export function edgePanSpeed(pointerX, trackWidth, spanMs) {
  const edge = Math.min(36, trackWidth / 4);
  const pressure = pointerX < edge ? -(edge - pointerX) / edge
    : pointerX > trackWidth - edge ? (pointerX - trackWidth + edge) / edge : 0;
  return Math.max(-1, Math.min(1, pressure)) * spanMs * .85;
}
