const button = document.querySelector(".demo-play");
const images = [...document.querySelectorAll("[data-motion]")];
const posters = images.map(image => image.getAttribute("src"));
const status = document.querySelector(".demo-status");
let downloads;
let playingUrls = [];

button.hidden = false;
button.addEventListener("click", async () => {
  if (playingUrls.length) {
    images.forEach((image, index) => { image.src = posters[index]; });
    playingUrls.forEach(url => URL.revokeObjectURL(url));
    playingUrls = [];
    button.setAttribute("aria-pressed", "false");
    button.textContent = button.dataset.play;
    return;
  }

  status.textContent = "";
  button.disabled = true;
  button.textContent = button.dataset.loading;
  try {
    // Keep both posters visible until the two animations are ready to start.
    downloads ??= Promise.all(images.map(async image => {
      const response = await fetch(image.dataset.motion);
      if (!response.ok) throw new Error("Animation download failed");
      return response.blob();
    }));
    const blobs = await downloads;
    playingUrls = blobs.map(blob => URL.createObjectURL(blob));
    images.forEach((image, index) => { image.src = playingUrls[index]; });
    button.setAttribute("aria-pressed", "true");
    button.textContent = button.dataset.stop;
  } catch {
    downloads = undefined;
    status.textContent = button.dataset.error;
    button.textContent = button.dataset.play;
  } finally {
    button.disabled = false;
  }
});
