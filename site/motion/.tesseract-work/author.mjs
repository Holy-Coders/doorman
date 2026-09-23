import fs from "node:fs";
import { URL } from "node:url";
// Run after checkout/import. Preserve document fields and packaged resources.
const path = new URL("./editable.json", import.meta.url);
const doc = JSON.parse(fs.readFileSync(path, "utf8"));
doc.dimensions = { width: 1920, height: 1080 };
doc.duration = 12;
doc.composition.name = "Janitor — continuity field";
const transform = {
  anchorPoint: [0, 0],
  position: [0, 0],
  scale: [100, 100],
  rotation: 0,
  opacity: 100,
};
doc.composition.layers = [
  {
    type: "Rect",
    id: 1,
    name: "Periodic continuity field",
    blendMode: "normal",
    activeRange: { start: 0, duration: 12000 },
    transform,
    rect: { size: [1920, 1080], fillColor: [0.03137, 0.04706, 0.04706, 1] },
    effects: [
      {
        id: 1,
        effect: {
          type: "customShader",
          name: "janitorContinuityField",
          description:
            "18 clear historical traces, three continuity orbits and one scanning light. A twelve-second closed loop; decorative, not live user data.",
          wgsl: fs.readFileSync(
            new URL("./field.wgsl", import.meta.url),
            "utf8",
          ),
          params: [
            {
              name: "animationTime",
              description: "Engine-driven local time, seconds",
              min: 0,
              max: 12,
              default: 0,
            },
            {
              name: "period",
              description: "Complete loop duration, seconds",
              min: 1,
              max: 60,
              default: 12,
            },
            {
              name: "intensity",
              description: "Rim light intensity",
              min: 0,
              max: 2,
              default: 1,
            },
          ],
        },
      },
    ],
  },
];
fs.writeFileSync(path, JSON.stringify(doc, null, 2) + "\n");
