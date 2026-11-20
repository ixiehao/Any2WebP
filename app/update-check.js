export const UPDATE_INTERVAL = 12 * 60 * 60 * 1000;
const FAILURE_RETRY = 60 * 60 * 1000;
const UNPUBLISHED_RETRY = 15 * 60 * 1000;
const STORAGE_KEY = "any2webp-update-meta-v1";
const timestamp = value => Number.isSafeInteger(value) && value >= 0 && value <= 8.64e15;

function version(tag) {
  if (typeof tag !== "string" || tag.trim() !== tag || !/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag)) return null;
  const parts = tag.replace(/^v/, "").split(".").map(Number);
  return parts.every(Number.isSafeInteger) ? parts : null;
}

function newer(tag, installed) {
  const candidate = version(tag);
  if (!candidate || !installed) return false;
  const difference = candidate.findIndex((part, index) => part !== installed[index]);
  return difference !== -1 && candidate[difference] > installed[difference];
}

export function createUpdateChecker({ installed, query, onChange, storage, now = Date.now }) {
  const current = version(installed);
  let saved;
  try { saved = JSON.parse(storage.getItem(STORAGE_KEY)); } catch { /* storage can be unavailable */ }
  let tag = newer(saved?.tag, current) ? saved.tag : null;
  let checkedAt = timestamp(saved?.checkedAt) ? saved.checkedAt : 0;
  let retryAt = timestamp(saved?.retryAt) ? saved.retryAt : 0;
  let backgroundAt = timestamp(saved?.backgroundAt) ? saved.backgroundAt : 0;
  let status = tag ? "available" : "idle";
  let pending = null;
  let checkedThisSession = false;

  function publish(next) {
    status = next;
    onChange({ status, tag, retryAt });
  }

  async function perform() {
    checkedThisSession = true;
    const result = await Promise.resolve().then(query).catch(() => null);
    status = result?.status;
    checkedAt = now();
    retryAt = 0;
    if (status === "available" && newer(result.tag, current)) {
      tag = result.tag;
    } else if (status === "current" || status === "unpublished") {
      tag = null;
    } else if (status === "rateLimited" && Number.isSafeInteger(result.retryAt) &&
      timestamp(result.retryAt * 1000) && result.retryAt * 1000 > checkedAt) {
      retryAt = result.retryAt * 1000;
    } else {
      status = "failed";
    }
    const interval = status === "failed" ? FAILURE_RETRY : status === "unpublished" ? UNPUBLISHED_RETRY : UPDATE_INTERVAL;
    backgroundAt = retryAt || checkedAt + interval;
    try { storage.setItem(STORAGE_KEY, JSON.stringify({ tag, checkedAt, retryAt, backgroundAt })); } catch { /* keep session state */ }
    publish(status);
  }

  function check(manual = false, launch = false) {
    if (pending) return pending;
    const time = now();
    if (time < checkedAt) checkedAt = retryAt = backgroundAt = 0;
    if (time < retryAt) {
      if (manual) publish("rateLimited");
      return;
    }
    if (!manual && !(launch && !checkedThisSession) && time < backgroundAt) return;
    publish("checking");
    pending = perform().finally(() => { pending = null; });
    return pending;
  }

  publish(status);
  return {
    showAvailable() { if (tag && !pending) publish("available"); },
    check,
    checkAtLaunch() { return check(false, true); },
  };
}
