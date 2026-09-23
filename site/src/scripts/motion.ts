const preference = matchMedia("(prefers-reduced-motion: reduce)");
const toggles = [
  ...document.querySelectorAll<HTMLButtonElement>("[data-motion-toggle]"),
];
let paused = false;
function updateMotion() {
  document.body.dataset.motion = preference.matches
    ? "reduced"
    : paused || document.hidden
      ? "paused"
      : "running";
  toggles.forEach((button) => {
    button.disabled = preference.matches;
    button.textContent = preference.matches
      ? "Reduced motion"
      : paused
        ? "Play motion"
        : "Pause motion";
    button.setAttribute("aria-pressed", String(!paused && !preference.matches));
  });
  if (preference.matches || paused)
    document
      .querySelectorAll(".actor-node")
      .forEach((node) =>
        node.getAnimations().forEach((animation) => animation.cancel()),
      );
}
toggles.forEach((button) =>
  button.addEventListener("click", () => {
    paused = !paused;
    updateMotion();
  }),
);
preference.addEventListener("change", updateMotion);
document.addEventListener("visibilitychange", updateMotion);
updateMotion();

if ("IntersectionObserver" in window) {
  const scenes = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        (entry.target as HTMLElement).dataset.inView = String(
          entry.isIntersecting,
        );
      });
    },
    { threshold: 0.1 },
  );
  document
    .querySelectorAll("[data-motion-scene]")
    .forEach((scene) => scenes.observe(scene));
  const reveals = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("sequence-visible");
        reveals.unobserve(entry.target);
      });
    },
    { threshold: 0.3 },
  );
  document
    .querySelectorAll("[data-pipeline], [data-jev-terminal]")
    .forEach((element) => reveals.observe(element));
} else
  document
    .querySelectorAll<HTMLElement>("[data-motion-scene]")
    .forEach((scene) => {
      scene.dataset.inView = "true";
    });
