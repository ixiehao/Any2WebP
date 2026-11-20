const button = document.querySelector(".demo-play");
const images = [...document.querySelectorAll("[data-motion]")];
const poses = images.map(image => image.getAttribute("src"));

button.hidden = false;
button.addEventListener("click", () => {
  const playing = button.getAttribute("aria-pressed") === "false";
  images.forEach((image, index) => {
    image.src = playing ? image.dataset.motion : poses[index];
  });
  button.setAttribute("aria-pressed", String(playing));
  button.textContent = playing ? button.dataset.stop : button.dataset.play;
});
