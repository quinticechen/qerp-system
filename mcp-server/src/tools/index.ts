/**
 * Tool registry — the single source every adapter reads from (docs/QUERY_AGENT_PHASE0.md §4.1).
 */

import { TOOL_GROUPS, type ToolName } from "../agent/permissions.js";
import type { RegisteredTool } from "./types.js";
import { customerTools } from "./customers.js";
import { orderTools } from "./orders.js";
import { productTools } from "./products.js";
import { inventoryTools } from "./inventory.js";
import { purchaseOrderTools } from "./purchase-orders.js";
import { shippingTools } from "./shipping.js";
import { factoryTools } from "./factories.js";

const ALL_TOOLS: RegisteredTool[] = [
  ...customerTools,
  ...orderTools,
  ...productTools,
  ...inventoryTools,
  ...purchaseOrderTools,
  ...shippingTools,
  ...factoryTools,
];

const TOOLS_BY_NAME = new Map<ToolName, RegisteredTool>();
for (const tool of ALL_TOOLS) {
  if (TOOLS_BY_NAME.has(tool.name)) throw new Error(`Duplicate tool definition: ${tool.name}`);
  TOOLS_BY_NAME.set(tool.name, tool);
}

// Every tool the permission layer can grant must have exactly one definition.
const missing = Object.values(TOOL_GROUPS).flat().filter((name) => !TOOLS_BY_NAME.has(name));
if (missing.length) throw new Error(`Tools listed in TOOL_GROUPS have no definition: ${missing.join(", ")}`);

/** Definitions for the given names, in the order given; unknown names are skipped. */
export function getTools(names: readonly ToolName[]): RegisteredTool[] {
  return names.flatMap((name) => TOOLS_BY_NAME.get(name) ?? []);
}

export function getAllTools(): readonly RegisteredTool[] {
  return ALL_TOOLS;
}
