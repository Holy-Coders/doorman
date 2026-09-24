// Decorative, local-only animation. No input telemetry, inference or network calls.
const stage = document.querySelector<HTMLElement>("[data-doorway]");
const canvas = stage?.querySelector<HTMLCanvasElement>("[data-doorway-canvas]");
try {
  const ctx = canvas?.getContext("2d");
  if (
    stage &&
    canvas &&
    ctx &&
    "ResizeObserver" in window &&
    "IntersectionObserver" in window
  )
    setup(stage, canvas, ctx);
} catch {
  // Retain the accessible static illustration if canvas is unavailable.
  stage?.removeAttribute("data-ready");
}

function setup(
  stage: HTMLElement,
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
) {
  const actors = ["human", "another", "robot", "assistant"];
  const names = ["A human", "Another human", "A robot", "An AI assistant"];
  const colors = ["#f5aacb", "#d9f35c", "#ffae42", "#baaff2"];
  const buttons = [
    ...stage.querySelectorAll<HTMLButtonElement>("[data-doorway-actor]"),
  ];
  const label = stage.querySelector<HTMLElement>("[data-doorway-label]")!;
  const mask = document.createElement("canvas");
  mask.width = 220;
  mask.height = 300;
  const pen = mask.getContext("2d", { willReadFrequently: true });
  if (!pen) return;
  const shapes = actors.map((actor) => {
    pen.clearRect(0, 0, 220, 300);
    pen.fillStyle = "white";
    const rect = (x: number, y: number, w: number, h: number, r = 0) => {
      pen.beginPath();
      pen.roundRect(x, y, w, h, r);
      pen.fill();
    };
    if (actor === "human" || actor === "another") {
      pen.beginPath();
      pen.arc(110, 62, 33, 0, Math.PI * 2);
      pen.fill();
      if (actor === "another") {
        rect(67, 27, 88, 75, 24);
        rect(65, 96, 22, 44, 8);
      }
      rect(72, 110, 76, 103, 19);
      rect(46, 121, 24, 101, 11);
      rect(150, 121, 24, 101, 11);
      rect(75, 200, 29, 93, 9);
      rect(116, 200, 29, 93, 9);
      if (actor === "another") rect(71, 30, 76, 21, 7);
    } else {
      rect(65, 40, 90, 70, 12);
      rect(104, 14, 12, 28, 3);
      rect(96, 7, 28, 12, 4);
      rect(72, 123, 76, 100, 9);
      rect(44, 130, 21, 76, 6);
      rect(155, 130, 21, 76, 6);
      rect(76, 232, 28, 59, 5);
      rect(116, 232, 28, 59, 5);
      if (actor === "assistant") {
        rect(11, 35, 25, 7);
        rect(20, 26, 7, 25);
        rect(181, 75, 30, 8);
        rect(192, 64, 8, 30);
      }
    }
    pen.clearRect(85, 62, 12, 12);
    pen.clearRect(123, 62, 12, 12);
    const pixels = pen.getImageData(0, 0, 220, 300).data;
    const points: [number, number][] = [];
    for (let y = 4; y < 300; y += 7)
      for (let x = 4; x < 220; x += 7)
        if (pixels[(y * 220 + x) * 4 + 3]! > 128)
          points.push([x - 110, y - 150]);
    return points;
  });
  let active = 0,
    elapsed = 0,
    previous = 0,
    raf = 0,
    visible = true;
  let width = 1000;
  const random = (n: number) => {
    const v = Math.sin(n * 127.1 + 71.7) * 43758.5453;
    return v - Math.floor(v);
  };
  const eased = (t: number) => {
    t = Math.max(0, Math.min(1, t));
    return t * t * (3 - 2 * t);
  };
  const running = () =>
    visible && !document.hidden && document.body.dataset.motion === "running";
  function select(index: number) {
    active = index;
    elapsed = 0;
    buttons.forEach((button, i) =>
      button.setAttribute("aria-pressed", String(i === active)),
    );
    label.textContent = names[active]!;
    label.style.setProperty("--actor-color", colors[active]!);
    stage.dataset.actor = actors[active];
  }
  function draw() {
    // Clear the actual backing bitmap, including after a display/DPR change.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(canvas.width / width, 0, 0, canvas.height / 500, 0, 0);
    const cycle = running() || elapsed ? Math.min(elapsed / 7200, 1) : 0.32;
    const assemble = eased(cycle / 0.21);
    const walk = eased((cycle - 0.45) / 0.36);
    const fade = 1 - eased((cycle - 0.79) / 0.13);
    const doorX = width * 0.77,
      center = width * 0.31;
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "#d9f35c";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(doorX - 65, 415);
    ctx.lineTo(doorX - 65, 113);
    ctx.lineTo(doorX + 65, 113);
    ctx.lineTo(doorX + 65, 415);
    ctx.stroke();
    ctx.strokeStyle = "#605f4e";
    ctx.beginPath();
    ctx.moveTo(doorX - 52, 128);
    ctx.lineTo(doorX + 39, 148);
    ctx.lineTo(doorX + 39, 386);
    ctx.lineTo(doorX - 52, 405);
    ctx.closePath();
    ctx.stroke();
    ctx.fillStyle = "#ffae42";
    ctx.fillRect(doorX + 20, 267, 7, 7);
    ctx.strokeStyle = "#45433d";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(55, 416);
    ctx.lineTo(width - 55, 416);
    ctx.stroke();
    const points = shapes[active]!;
    points.forEach(([x, y], i) => {
      const seed = i + active * 773;
      const scatterX = random(seed) * width;
      const scatterY = random(seed + 999) * 430 + 20;
      const targetX = center + x + (doorX - center) * walk;
      const targetY = 261 + y;
      const px = scatterX + (targetX - scatterX) * assemble;
      const py = scatterY + (targetY - scatterY) * assemble;
      const accent = random(seed + 212);
      ctx.fillStyle =
        accent < 0.15
          ? "#fff5e3"
          : accent < 0.25
            ? colors[(active + 1) % 4]!
            : colors[active]!;
      ctx.globalAlpha = fade * (0.7 + random(seed + 20) * 0.3);
      const size = 4.7 + random(seed + 33) * 1.3;
      ctx.fillRect(Math.round(px), Math.round(py), size, size);
    });
    ctx.globalAlpha = 1;
    label.style.opacity = String(1 - walk);
    stage.dataset.phase =
      assemble < 1 ? "forming" : walk > 0.02 ? "entering" : "formed";
  }
  function frame(now: number) {
    raf = 0;
    if (!running()) {
      previous = 0;
      stage.dataset.animating = "false";
      draw();
      return;
    }
    stage.dataset.animating = "true";
    if (!previous) previous = now;
    if (now - previous >= 30) {
      elapsed += Math.min(now - previous, 80);
      previous = now;
      if (elapsed >= 7200) select((active + 1) % actors.length);
      draw();
    }
    raf = requestAnimationFrame(frame);
  }
  function refresh() {
    cancelAnimationFrame(raf);
    raf = 0;
    previous = 0;
    if (document.body.dataset.motion === "reduced") elapsed = 2300;
    stage.dataset.animating = String(running());
    draw();
    if (running()) raf = requestAnimationFrame(frame);
  }
  function resize() {
    const bounds = canvas.getBoundingClientRect();
    width = Math.max(680, Math.min(bounds.width, 1120));
    const ratio = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(bounds.width * ratio);
    canvas.height = Math.round(bounds.height * ratio);
    refresh();
  }
  buttons.forEach((button, i) => {
    button.disabled = false;
    button.addEventListener("click", () => {
      select(i);
      if (!running()) elapsed = 2300;
      refresh();
    });
    button.addEventListener("keydown", (event) => {
      const direction =
        event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
      if (!direction) return;
      event.preventDefault();
      const next = (i + direction + buttons.length) % buttons.length;
      buttons[next]!.focus();
      buttons[next]!.click();
    });
  });
  const visibility = new IntersectionObserver(
    ([entry]) => {
      visible = !!entry?.isIntersecting;
      refresh();
    },
    { threshold: 0.05 },
  );
  visibility.observe(stage);
  const size = new ResizeObserver(resize);
  size.observe(canvas);
  const motion = new MutationObserver(refresh);
  motion.observe(document.body, {
    attributes: true,
    attributeFilter: ["data-motion"],
  });
  document.addEventListener("visibilitychange", refresh);
  window.addEventListener(
    "pagehide",
    (event) => {
      if (event.persisted) return;
      cancelAnimationFrame(raf);
      visibility.disconnect();
      size.disconnect();
      motion.disconnect();
      document.removeEventListener("visibilitychange", refresh);
    },
    { once: true },
  );
  window.addEventListener("pageshow", refresh);
  select(0);
  stage.dataset.ready = "true";
  resize();
}
