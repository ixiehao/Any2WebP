export function basename(path) {
  const windowsPath = /^(?:[A-Za-z]:[\\/]|\\\\)/.test(path);
  return path.split(windowsPath ? /[\\/]/ : "/").at(-1) || path;
}
