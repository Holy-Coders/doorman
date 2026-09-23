const preference = matchMedia("(prefers-reduced-motion: reduce)");
const toggles = [
  ...document.querySelectorAll<HTMLButtonElement>("[data-motion-toggle]"),
];
let paused = false;
const film = document.querySelector<HTMLVideoElement>("[data-hero-video]");
const connection = (
  navigator as Navigator & {
    connection?: EventTarget & { saveData?: boolean };
  }
).connection;
let requestedPlayback = false;
let filmVisible = !("IntersectionObserver" in window);
let filmFailed = false;
let playbackAttempt = 0;
const savingData = () => !!connection?.saveData && !requestedPlayback;

function updateFilm() {
  if (!film) return;
  const attempt = ++playbackAttempt;
  if (
    preference.matches ||
    paused ||
    document.hidden ||
    !filmVisible ||
    savingData() ||
    filmFailed
  ) {
    film.pause();
    return;
  }
  if (!film.dataset.loaded) {
    film
      .querySelectorAll<HTMLSourceElement>("source[data-src]")
      .forEach((source) => {
        source.src = source.dataset.src!;
      });
    film.dataset.loaded = "true";
    film.muted = true;
    film.load();
  }
  void film
    .play()
    .then(() => {
      if (attempt === playbackAttempt) film.dataset.ready = "true";
    })
    .catch(() => {
      // A browser may reject autoplay. Keep the poster and offer explicit playback.
      if (attempt !== playbackAttempt) return;
      paused = true;
      updateMotion();
    });
}
function updateMotion() {
  document.body.dataset.motion = preference.matches
    ? "reduced"
    : paused || document.hidden || savingData()
      ? "paused"
      : "running";
  toggles.forEach((button) => {
    button.hidden = false;
    button.disabled = preference.matches || filmFailed;
    button.textContent = filmFailed
      ? "Motion unavailable"
      : preference.matches
        ? "Reduced motion"
        : paused || savingData()
          ? "Play motion"
          : "Pause motion";
    button.setAttribute(
      "aria-pressed",
      String(!paused && !preference.matches && !savingData() && !filmFailed),
    );
  });
  if (preference.matches || paused)
    document
      .querySelectorAll(".actor-node")
      .forEach((node) =>
        node.getAnimations().forEach((animation) => animation.cancel()),
      );
  updateFilm();
}
toggles.forEach((button) =>
  button.addEventListener("click", () => {
    paused = savingData() ? false : !paused;
    requestedPlayback = true;
    updateMotion();
  }),
);
preference.addEventListener("change", updateMotion);
document.addEventListener("visibilitychange", updateMotion);
connection?.addEventListener("change", updateMotion);
film?.addEventListener("error", () => {
  filmFailed = true;
  delete film.dataset.ready;
  updateMotion();
});
if (film && "IntersectionObserver" in window) {
  new IntersectionObserver(
    ([entry]) => {
      filmVisible = entry?.isIntersecting ?? false;
      updateFilm();
    },
    { threshold: 0.05 },
  ).observe(film);
}
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
