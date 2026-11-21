export const bytesPerKB = 1000;
export const bytesPerMB = 1000 * bytesPerKB;
export const fileLimitBytes = 64 * 1024 * 1024;
export const frameBudgetBytes = 512 * 1024 * 1024;

export function sizeText(bytes) {
  if (bytes < bytesPerKB) return bytes + " B";
  if (bytes < bytesPerMB) return (bytes / bytesPerKB).toFixed(1) + " KB";
  return (bytes / bytesPerMB).toFixed(2) + " MB";
}
