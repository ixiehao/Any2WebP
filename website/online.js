import { sizeText } from "./byte-size.js";

const section = document.getElementById("online");
const messages = JSON.parse(section.dataset.messages);
const pick = section.querySelector("button");
const input = section.querySelector('input[type="file"]');
const download = section.querySelector(".online-download");
const status = section.querySelector(".online-status");
const maxBytes = 16_000_000;
let worker;
let objectUrl;

function reset() {
  worker?.terminate();
  worker = undefined;
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = undefined;
  download.hidden = true;
  download.removeAttribute("href");
}

if (typeof Worker === "function" && typeof WebAssembly === "object") {
  pick.disabled = false;
  pick.addEventListener("click", () => input.click());
  input.addEventListener("change", () => {
    const file = input.files[0];
    if (!file) return;
    input.value = "";
    reset();
    if (!file.size || file.size > maxBytes) {
      status.textContent = messages[file.size ? "limit" : "decode"];
      return;
    }
    status.textContent = messages.working;
    try {
      const job = new Worker(new URL("./online-worker.js?v=1", import.meta.url));
      worker = job;
      job.onmessage = ({ data }) => {
        if (worker !== job) return;
        job.terminate();
        worker = undefined;
        if (data.error) {
          status.textContent = messages[data.error] ?? messages.error;
          return;
        }
        objectUrl = URL.createObjectURL(new Blob([data.webp], { type: "image/webp" }));
        download.href = objectUrl;
        download.download = (file.name.replace(/\.[^.]+$/, "") || "image") + ".webp";
        download.hidden = false;
        status.textContent = messages.done.replace("{size}", sizeText(data.webp.byteLength));
      };
      job.onerror = () => {
        if (worker !== job) return;
        reset();
        status.textContent = messages.error;
      };
      job.postMessage(file);
    } catch {
      reset();
      status.textContent = messages.error;
    }
  });
} else {
  status.textContent = messages.unavailable;
}
