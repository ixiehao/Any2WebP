import { errorMessage, message } from "./i18n.js";

const errorKeys = new Set(["ffmpegMissing", "ffmpegIncomplete", "ffmpegUnusable"]);
export function dependencyError(value) {
  const key = typeof value === "string" ? value.replace(/^ui:/, "") : value?.key;
  return errorKeys.has(key) ? key : null;
}

export function bindVideoDependencies(invoke, setText, onReady) {
  const $ = id => document.getElementById(id);
  const dialog = $("dependency-dialog");
  const panel = $("dependency-report");
  let report = null;
  let busy = null;
  let error = null;

  function render() {
    const ready = !busy && report?.status === "ready";
    const keys = { missing: "ffmpegMissing", incomplete: "ffmpegIncomplete", unusable: "ffmpegUnusable" };
    const status = busy ? message(busy === "install" ? "dependencyInstalling" : "dependencyChecking")
      : ready ? message("dependencyReady", { version: report.version })
        : message(keys[report?.status] || "dependencyCheckFailed");
    panel.dataset.state = busy ? "pending" : ready ? "ready" : "unavailable";
    setText("dependency-state", status);
    $("dependency-detail").hidden = !ready || !report?.directory;
    $("dependency-detail").textContent = ready ? report.directory || "" : "";
    const needsTool = !busy && report && !ready;
    $("dependency-install").hidden = !needsTool || !report?.homebrewAvailable;
    $("dependency-homebrew").hidden = !needsTool || Boolean(report?.homebrewAvailable);
    $("dependency-recheck").disabled = Boolean(busy);
    $("dependency-brew-hint").hidden = !needsTool || Boolean(report?.homebrewAvailable);
    $("dependency-manual").hidden = !needsTool || !report?.homebrewAvailable;
    $("dependency-repair").hidden = report?.status === "missing";
    $("dependency-error").hidden = !error;
    setText("dependency-error", error);
  }

  async function run(action) {
    if (busy) return;
    busy = action;
    error = null;
    render();
    try {
      report = await invoke(action === "install" ? "install_video_dependencies" : "check_video_dependencies");
      if (report.status === "ready") onReady();
      else if (action === "install") error = message("dependencyPostInstall");
    } catch (failure) {
      error = errorMessage(failure);
      if (action === "install") {
        try {
          report = await invoke("check_video_dependencies");
          if (report.status === "ready") onReady();
        } catch { /* keep the original installation error */ }
      } else {
        report = null;
      }
    } finally {
      busy = null;
      render();
    }
  }

  $("dependency-recheck").onclick = () => run("check");
  $("dependency-install").onclick = () => run("install");
  $("dependency-homebrew").onclick = async () => {
    try { await invoke("open_homebrew"); }
    catch (failure) {
      error = errorMessage(failure);
      render();
    }
  };
  return () => {
    if (!dialog.open) dialog.showModal();
    run("check");
  };
}
