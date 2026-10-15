/**
 * The database consistency check's parsing and comparisons (evals/db-check.ts) — no network.
 * Run: bun run test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import {
  apiDocCodes, compareRoles, extractToolSelects, fakeApiCodes, fixtureShape, fixtureStatuses, parseSignatureHint, toolEnumValues,
} from "../evals/db-check.js";
import { fakeApiParams } from "../evals/fake-api.js";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("tool selects are read from the tool sources, whitespace removed", () => {
  assert.deepEqual(
    extractToolSelects(`let q = supabase.from("orders").select("id, order_number, customers(name)").eq("x", 1);\nctx.supabase.from(table).select("id")`),
    [{ table: "orders", select: "id,order_number,customers(name)" }],
  );
  const all = readdirSync(new URL("../src/tools/", import.meta.url)).flatMap((f) => extractToolSelects(read(`../src/tools/${f}`)));
  assert.ok(all.length >= 12, "every read tool's query is found");
});

test("fixture shape separates columns from nested objects; statuses are collected", () => {
  const tables = {
    orders: [{ id: "1", status: "pending", customers: { name: "A" } }, { id: "2", status: "confirmed", note: null }],
    empty: [],
  };
  assert.deepEqual(fixtureShape(tables), [{ table: "orders", columns: ["id", "note", "status"], nested: ["customers"] }]);
  assert.deepEqual(fixtureStatuses(tables).map((s) => s.value), ["pending", "confirmed"]);
});

test("the order status tool's enum values are checked against the orders table", () => {
  const values = toolEnumValues();
  assert.ok(values.some((v) => v.table === "orders" && v.column === "payment_status" && v.value === "partial_paid"));
});

test("a PGRST202 hint names the function's real parameters", () => {
  const hint = "Perhaps you meant to call the function public.create_order(p_customer_id, p_dry_run, p_factory_ids, p_items, p_note, p_organization_id)";
  assert.deepEqual(parseSignatureHint(hint), ["p_customer_id", "p_dry_run", "p_factory_ids", "p_items", "p_note", "p_organization_id"]);
  assert.deepEqual(parseSignatureHint(hint), fakeApiParams().create_order, "fake-api.ts declares the same parameters");
  assert.equal(parseSignatureHint(null), null);
});

test("every error code the simulated APIs raise is documented in docs/API.md", () => {
  const documented = apiDocCodes(read("../../docs/API.md"));
  assert.ok(documented.has("forbidden") && documented.has("customer_name_taken"));
  const raised = fakeApiCodes(read("../evals/fake-api.ts"));
  assert.ok(raised.includes("use_cancel_order"));
  assert.deepEqual(raised.filter((c) => !documented.has(c)), []);
});

test("roles.json is compared with role_permissions; the owner holds the admin's keys", () => {
  const rows = [
    { role: "admin", permission_key: "canViewOrders" }, { role: "admin", permission_key: "canEditOrders" },
    { role: "viewer", permission_key: "canViewOrders" },
  ];
  assert.deepEqual(compareRoles({
    owner: { isOwner: true, grants: ["canViewOrders", "canEditOrders"] },
    admin: { isOwner: false, grants: ["canViewOrders", "canEditOrders"] },
    viewer: { isOwner: false, grants: ["canViewOrders"] },
  }, rows), []);
  assert.deepEqual(compareRoles({
    owner: { isOwner: true, grants: ["canViewOrders"] },
    viewer: { isOwner: false, grants: ["canViewOrders", "canEditOrders"] },
    sales: { isOwner: false, grants: [] },
  }, rows).map((i) => i.detail), [
    "owner 缺少：canEditOrders",
    "viewer 多出：canEditOrders",
    "roles.json 的角色「sales」不在 role_permissions",
    "role_permissions 的角色「admin」不在 roles.json",
  ]);
});
