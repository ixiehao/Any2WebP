export const MAX_VIDEO_FPS = 30;

export function minimumClipMs(fps) {
  return Math.round(1000 / fps) + 1;
}

export function formatTimecode(milliseconds, precise = true) {
  const total = Math.max(0, Math.round(milliseconds));
  const seconds = Math.floor(total / 1000);
  const parts = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60];
  if (!precise && parts[0] === 0) parts.shift();
  const clock = parts.map(part => String(part).padStart(2, "0")).join(":");
  return precise ? clock + "." + String(total % 1000).padStart(3, "0") : clock;
}

export function parseTimecode(text) {
  const fields = text.trim().split(":");
  if (fields.length > 3 || !/^\d+(?:\.\d{1,3})?$/.test(fields.at(-1))
      || fields.slice(0, -1).some(field => !/^\d+$/.test(field))) return null;
  const values = fields.map(Number);
  if ((values.length > 1 && values.at(-1) >= 60)
      || (values.length === 3 && values[1] >= 60)) return null;
  const ms = Math.round(values.reduce((total, part) => total * 60 + part, 0) * 1000);
  return Number.isSafeInteger(ms) ? ms : null;
}

export function stepSourceFrame(time, count, fps, min, max) {
  const frame = time * fps / 1000;
  const nearest = Math.round(frame);
  const position = Math.abs(frame - nearest) <= fps / 2000 ? nearest : frame;
  const index = (count < 0 ? Math.ceil(position) : Math.floor(position)) + count;
  return Math.max(min, Math.min(max, Math.round(index * 1000 / fps)));
}

export function videoClipLimits(info, { fps, edge }) {
  if (!Number.isInteger(fps) || fps < 1 || fps > MAX_VIDEO_FPS ||
      !Number.isInteger(edge) || edge < 2 || edge > 1920) return null;
  const minor = Math.max(1, Math.round(edge * Math.min(info.width, info.height) / Math.max(info.width, info.height)));
  const frameLimit = Math.min(600, Math.floor(info.frameBudgetBytes / (edge * minor * 4)));
  return {
    minMs: minimumClipMs(fps),
    maxMs: Math.min(info.durationMs, Math.round(frameLimit * 1000 / fps)),
  };
}

export function clipFromPlayhead(position, requestedMs, duration, limits) {
  if (!limits) return null;
  const endMs = Math.min(position + requestedMs, position + limits.maxMs, duration);
  return endMs - position >= limits.minMs ? { startMs: position, endMs } : null;
}

export function videoSettingsError(info, settings) {
  const { startMs, endMs } = settings;
  const length = endMs - startMs;
  if (!Number.isSafeInteger(startMs) || !Number.isSafeInteger(endMs) ||
      startMs < 0 || endMs > info.durationMs || length <= 0) return "invalidTrim";
  const limits = videoClipLimits(info, settings);
  if (!limits) return "invalidDimensions";
  if (length < limits.minMs) return "minFrames";
  return length > limits.maxMs ? "maxFrames" : "";
}
