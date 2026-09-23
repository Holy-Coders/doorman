/** Public author links pinned to the evaluated bytes. Research data is never redistributed. */
export const SOURCES = {
  fpstalker: {
    url: "https://github.com/Spirals-Team/FPStalker",
    revision: "60b4fed8cd669495c5a3cf6cd007480f977e56ca",
    terms:
      "Repository AGPL-3.0; no separate data license established. Independent parser, no upstream algorithm code or data redistributed.",
    files: [
      {
        name: "extension1.txt.tar.gz",
        bytes: 73169899,
        sha256:
          "4791cdbe989e21195862813a3e8ca69dce53e1211a7c4b191eac54d81a712b3f",
      },
      {
        name: "extension2.txt.tar.gz",
        bytes: 69956820,
        sha256:
          "2ea55958c4dde4722014cc0766752c2f254de6159b660341bd9f7c9313de7f42",
      },
      {
        name: "fpstalker-schema.sql",
        path: "extensionDataScheme.sql",
        bytes: 3655,
        sha256:
          "509aba0c44459a0cd6c40f3db38d126d22d6282fb3c8c888ace73440596e4a3d",
      },
    ],
  },
  fpagent: {
    url: "https://github.com/ethanbwang/fp-agent",
    revision: "a9bdba8701ec0447e98462e95780ea3b0beefd6a",
    terms:
      "Author-publicized OSF view-only download. No explicit reusable data/model license found in inspected repository or OSF metadata. Local evaluation only.",
    files: [
      {
        name: "fpagent-raw.json",
        bytes: 4256214855,
        sha256:
          "e07847509a4851acb18e2390f5bf364c9b2f9c25588fce9f34929a872524cde3",
        url: "https://osf.io/download/fc85n/?view_only=ac4ad89fbde540269aaaa85a2249cad6",
      },
    ],
  },
  balabit: {
    url: "https://github.com/balabit/Mouse-Dynamics-Challenge",
    revision: "d00d6f779254a2a917deeab4a5b7a9e8643bd91e",
    terms:
      "README invites research benchmarking and requests citation; no explicit license found. No raw data or trained weights redistributed.",
    files: [
      {
        name: "balabit.tar.gz",
        bytes: 44628882,
        sha256:
          "f4c484c30678c3c58235f6ee78e35636f29abd2e69f379bbb46aec7ca083acef",
        url: "https://codeload.github.com/balabit/Mouse-Dynamics-Challenge/tar.gz/d00d6f779254a2a917deeab4a5b7a9e8643bd91e",
      },
    ],
  },
} as const;
export type Source = keyof typeof SOURCES;
export function sourceNames(argument = "all"): Source[] {
  if (argument === "all") return ["fpstalker", "fpagent", "balabit"];
  if (Object.hasOwn(SOURCES, argument)) return [argument as Source];
  throw new Error("Choose all, fpstalker, fpagent or balabit");
}
