import { createNodeVisitor } from "../node/index.js";
import type { NodeVisitorOptions } from "../node/index.js";
export type VercelVisitorOptions = NodeVisitorOptions;
export function createVercelVisitor(options: VercelVisitorOptions) {
  return createNodeVisitor(options);
}

export { createDoorman } from "../node/index.js";
