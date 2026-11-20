export function currentExport(file, settings) {
  return Boolean(file.result && !file.error &&
    file.exportSettings?.format === settings.format &&
    file.exportSettings?.destination === settings.destination &&
    file.exportSettings?.targetBytes === settings.targetBytes);
}

export function planExports(files, settings) {
  const pending = files.filter(file => !currentExport(file, settings));
  const repeat = !pending.length && files.length > 0;
  return { queued: repeat ? [...files] : pending, repeat };
}
