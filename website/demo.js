const pair = document.querySelector(".sample-pair");
const button = document.querySelector(".demo-play");
const status = document.querySelector(".demo-status");
const canvases = [...pair.querySelectorAll("canvas")];
const contexts = canvases.map(canvas => canvas.getContext("2d"));
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const frameCount = 60;
const frameDuration = 50;
const sheetColumns = 8;
let sheet;
let shownFrame = 0;
let animationFrame = 0;
let startedAt = 0;
let observer;

function paint(frame) {
  // The source GIF and exported WebP have identical visible pixels in every frame.
  canvases.forEach(({ width, height }, index) => {
    const context = contexts[index];
    const x = (frame % sheetColumns) * width;
    const y = Math.floor(frame / sheetColumns) * height;
    context.clearRect(0, 0, width, height);
    context.drawImage(sheet, x, y, width, height, 0, 0, width, height);
  });
  shownFrame = frame;
}

function animate(now) {
  const elapsed = Math.max(0, now - startedAt);
  const frame = Math.floor(elapsed / frameDuration) % frameCount;
  if (frame !== shownFrame) paint(frame);
  animationFrame = requestAnimationFrame(animate);
}

function pause() {
  cancelAnimationFrame(animationFrame);
  animationFrame = 0;
  button.textContent = button.dataset.resume;
}

async function play() {
  if (animationFrame || button.disabled) return;
  if (!sheet) {
    status.textContent = "";
    button.disabled = true;
    button.textContent = button.dataset.loading;
    try {
      const image = new Image();
      image.src = pair.dataset.frames;
      await image.decode();
      sheet = image;
      paint(0);
      for (const canvas of canvases) {
        canvas.previousElementSibling.hidden = true;
        canvas.hidden = false;
      }
    } catch {
      sheet = undefined;
      status.textContent = button.dataset.error;
      button.textContent = button.dataset.play;
      return;
    } finally {
      button.disabled = false;
    }
  }

  startedAt = performance.now() - shownFrame * frameDuration;
  button.textContent = button.dataset.pause;
  animationFrame = requestAnimationFrame(animate);
}

button.hidden = false;
button.addEventListener("click", () => {
  observer?.disconnect();
  if (animationFrame) pause();
  else play();
});
if (!reducedMotion.matches) {
  observer = new IntersectionObserver(entries => {
    if (entries.some(entry => entry.isIntersecting)) {
      observer.disconnect();
      if (!reducedMotion.matches) play();
    }
  });
  observer.observe(pair);
}
