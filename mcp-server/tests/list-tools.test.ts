/**
 * Customer and factory lists: active records first, deactivated ones last and marked, so a reply
 * can list them at the bottom as「已停用」(deactivated).
 * Run: bun run test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getAllTools } from "../src/tools/index.js";
import type { ToolContext } from "../src/tools/types.js";
import { createFakeSupabase, type Tables } from "../evals/fake-supabase.js";

const USER_ID = "0a000000-0000-4000-8000-000000000001";
const ORG_ID = "0e000000-0000-4000-8000-000000000001";
const fixtures: Tables = JSON.parse(readFileSync(new URL("../evals/fixtures/real.json", import.meta.url), "utf8"));
const tool = (name: string) => getAllTools().find((t) => t.name === name)!;

interface ListedRow { name: string; is_active: boolean }

async function list(name: string): Promise<ListedRow[]> {
  const ctx: ToolContext = { supabase: createFakeSupabase(fixtures, USER_ID).client, userId: USER_ID, organizationId: ORG_ID };
  const result = await tool(name).run(ctx, {});
  assert.ok(result.ok, JSON.stringify(result));
  return result.data as ListedRow[];
}

for (const [name, table] of [["list_customers", "customers"], ["list_factories", "factories"]] as const) {
  test(`${name} returns every record of the organization, deactivated ones last with is_active`, async () => {
    const rows = await list(name);
    const own = fixtures[table].filter((r) => r.organization_id === ORG_ID);
    assert.equal(rows.length, own.length);
    assert.ok(rows.every((r) => typeof r.is_active === "boolean"));
    const firstInactive = rows.findIndex((r) => !r.is_active);
    assert.ok(firstInactive > 0, "the fixtures hold a deactivated record");
    assert.ok(rows.slice(firstInactive).every((r) => !r.is_active), "no active record after a deactivated one");
  });
}
