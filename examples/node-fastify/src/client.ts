import { createDoormanClient } from "@aarondovturkel/doorman-browser";
const visitor = createDoormanClient({
  endpoint: "/api/visitor",
  collection: "extended",
});
const output = document.querySelector("pre")!;
document.querySelector("button")!.addEventListener("click", async () => {
  try {
    output.textContent = JSON.stringify(await visitor.identify(), null, 2);
  } catch (error) {
    output.textContent =
      error instanceof Error ? error.message : "Identification failed";
  }
});
window.addEventListener(
  "pagehide",
  (event) => {
    if (!event.persisted) visitor.destroy();
  },
  { once: true },
);
