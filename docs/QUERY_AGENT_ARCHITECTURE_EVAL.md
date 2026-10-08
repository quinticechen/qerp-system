# Query Agent Architecture Evaluation (P0-7)

> Date: 2026-10-07
> Decision: **Maintain Router × gemini-2.5-flash-lite** (User decision)
> Related Documents: [QUERY_AGENT_PHASE0.md](https://www.google.com/search?q=./QUERY_AGENT_PHASE0.md) (D6, §4.7)

## 1. Objectives & Decision Criteria

Compare Query's agent architectures and primary models to select the production configuration. The criteria were set by the user:

| Criterion | Threshold |
| --- | --- |
| Cost | As cheap as possible |
| Accuracy (Eval task completion rate) | Greater than 85% |
| Latency | Acceptable within 10 seconds |

---

## 2. Conclusion

| Configuration | Accuracy > 85% | Average Latency < 10s | Every Request < 10s | Cost |
| --- | --- | --- | --- | --- |
| **Router × flash-lite (Selected)** | ✅ 86% | ✅ 6.0s | ⚠️ 10% of requests > 10s | Lowest, approx. US$0.4 / 1k requests |
| Single Agent × flash-lite | ❌ 82% | ✅ | ✅ | Approx. US$1.5 / 1k requests |
| Router × flash | ✅ 89% | ✅ | ✅ Max 5.7s | Approx. US$1.4 / 1k requests |
| Single Agent × flash | ✅ 92% | ✅ | ⚠️ 1% slightly over (Max 10.5s) | Approx. US$2.3 / 1k requests |

**Selected: Router × flash-lite** — It meets the accuracy threshold (86%) while maintaining the lowest cost.

**Two points to note:**

1. **Very narrow accuracy margin**: 86% is only 1 percentage point above the threshold. Each eval case runs 3 times with nearly identical outputs (F9); a single case shifting from pass to fail would drop the score to 83%.
2. **If the latency standard means "every single request" must be under 10 seconds, flash-lite does not qualify**: About 10% of requests take 15–28 seconds (see §5.3). If the standard refers to average latency, it qualifies. If every request must be under 10 seconds, the cheapest qualifying option is **Router × flash** (89%, max 5.7s, approx. US$1.4 / 1k requests). See §7 for switching instructions.

---

## 3. Compared Configurations

| Dimension | Options |
| --- | --- |
| **Architecture** | • **Router**: Router uses an LLM to classify intent and rewrite tasks, handing them off to commercial / supply_chain sub-agents (can call both concurrently)<br>

<br>• **Single Agent**: A single agent holds all authorized tools (currently 17), directly processing the raw message |
| **Primary Model** | `google/gemini-2.5-flash-lite` (Current), `google/gemini-2.5-flash` |
| **Fallback Order** | Primary model → remaining models in list (flash-lite → flash → claude-haiku-4.5 order, with primary moved to front) |

Both architectures share the same tools, permissions, draft confirmations, output guards, and gateway fallback rules. The Router architecture's sub-agent prompts remain identical to pre-comparison wording. The Single Agent's prompt is formed by merging the two sub-agent prompts.

---

## 4. Testing Methodology

### 4.1 Eval Harness

* **Real Model + Fake Data Layer**: Models are actually called via OpenRouter; the database is an in-memory mock (`mcp-server/evals/fake-supabase.ts`) applying real filters and field selection without connecting to Supabase or writing data.
* **Production-identical Path**: Permissions go through the real `authGuard` (roles taken from database system roles); chat history passes through `toModelHistory`; writes generate drafts only.
* **Data**: `evals/fixtures/basic.json`, two organizations (the second organization's data consists exclusively of "latest" or "low stock" items to detect cross-organization data leaks).
* **Cases**: 29 cases, 3 runs per case per configuration (87 total runs per config).

| Category | Count | Content |
| --- | --- | --- |
| Query | 9 | Customers, latest PO, low stock, inventory, unpaid orders, factories, shipping, ID non-leakage |
| Write | 4 | Create order, customer not found, create PO, cross-domain order (🚧 Known limitation, unscored) |
| Permission | 3 | Accounting cannot create orders, warehouse cannot view customers, sales cannot create POs |
| Regression | 4 | Past incidents: duplicate message history, multi-turn orders, entity memory, post-confirmation next requests |
| Paraphrase | 9 | Newly added: same intent as existing cases but different wording, mitigating F9 (identical output per config) skew |

### 4.2 Per-Run Checks

* **Universal checks**: Request does not throw exceptions, responses do not contain UUIDs, **no business data writes occur during AI flows**.
* **Case-specific checks**: Tools called/not called, tool arguments, router routing (N/A for Single Agent), number of drafts created, mandatory/forbidden text in responses.

### 4.3 Metrics

* **Task Completion Rate (Accuracy)**: Percentage of runs passing all checks (excluding known limitation cases).
* **Tool Selection Accuracy**: Percentage of runs passing tool-related checks.
* **Error Rate**: Percentage of requests throwing exceptions.
* **Fallback Rate**: Percentage of runs where at least one model attempt failed and fell back to the next model.
* **Latency**: Total request time (including Router and all model calls; data layer resides in-memory, incurring negligible overhead).
* **Token Count**: Sub-agent prompt + completion tokens; Router's own calls are excluded.

### 4.4 Cost Estimation Method

Cost per 1,000 requests = Average tokens × Unit price. Unit prices from OpenRouter (2026-10-07):

| Model | Input (per million tokens) | Output (per million tokens) |
| --- | --- | --- |
| gemini-2.5-flash-lite | US$0.10 | US$0.40 |
| gemini-2.5-flash | US$0.30 | US$2.50 |
| claude-haiku-4.5 | US$1.00 | US$5.00 |

*Assumptions*: Input to output ratio approx. 92:8; Router architecture adds approx. 600 input / 50 output tokens per Router call; fallback models add fallback-tier costs. **Figures are estimates** used for order-of-magnitude comparison; actual production usage can be tracked via `query_traces` token columns.

---

## 5. Results

Report files located in `mcp-server/evals/reports/` (`*-p0-7-router-lite`, `*-p0-7-single-lite`, `*-p0-7-router-flash`, `*-p0-7-single-flash`; `.md` for human-readable reports, `.json` containing run-level details).

### 5.1 Summary Table

| Configuration | Accuracy | Tool Selection | Error Rate | Fallback Rate | Avg Latency | P90 Latency | Max Latency | > 10s Count | Avg Tokens | Cost / 1k Req |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Router × flash-lite (Current)** | **86%** | **89%** | **0%** | **4%** | **6.0s** | **15.0s** | **27.9s** | **9/84 (10%)** | **2,421** | **≈ US$0.4** |
| Single Agent × flash-lite | 82% | 86% | 4% | 43% | 3.4s | 6.0s | 9.9s | 0/84 (0%) | 4,301 | ≈ US$1.5 (incl. 43% fallback to flash) |
| Router × flash | 89% | 93% | 0% | 2% | 3.4s | 5.0s | 5.7s | 0/84 (0%) | 2,221 | ≈ US$1.4 |
| Single Agent × flash | 92% | 93% | 0% | 8% | 2.9s | 5.0s | 10.5s | 1/84 (1%) | 4,788 | ≈ US$2.3 |

### 5.2 Case Breakdown (Passes / 3)

| Case | Router × flash-lite | Single × flash-lite | Router × flash | Single × flash |
| --- | --- | --- | --- | --- |
| `p-accounting-cannot-create-order` Accounting role cannot create orders | 3/3 | 3/3 | 3/3 | 3/3 |
| `p-sales-cannot-create-po` Sales role cannot create POs | 3/3 | 3/3 | 3/3 | 3/3 |
| `p-warehouse-no-customers` Warehouse role cannot view customer data | 3/3 | 3/3 | 3/3 | 3/3 |
| `pp-create-order` Paraphrase: Open a new order | 3/3 | 3/3 | 3/3 | 3/3 |
| `pp-create-po` Paraphrase: Order fabric from factory | 0/3 | 0/3 | 0/3 | 0/3 |
| `pp-customers` Paraphrase: Customer list | 3/3 | 3/3 | 3/3 | 3/3 |
| `pp-inventory` Paraphrase: Inventory stock left (color first) | 3/3 | 3/3 | 3/3 | 3/3 |
| `pp-latest-po` Paraphrase: Most recent PO | 3/3 | 3/3 | 3/3 | 3/3 |
| `pp-low-stock` Paraphrase: Fabrics running low | 3/3 | 0/3 | 3/3 | 3/3 |
| `pp-multi-turn-answer` Multi-turn: Asked for customer last turn, reply name only (F1 type) | 3/3 | 3/3 | 3/3 | 3/3 |
| `pp-order-with-product` Cross-domain: Customer wants to order specific product (only order creation itself) | 0/3 | 0/3 | 0/3 | 2/3 |
| `pp-unpaid` Paraphrase: Unpaid orders | 3/3 | 3/3 | 2/3 | 3/3 |
| `q-customer-contact` Query customer contact info by name | 3/3 | 3/3 | 3/3 | 3/3 |
| `q-factories` Partner factories list | 3/3 | 3/3 | 3/3 | 3/3 |
| `q-inventory-search` Query specific product inventory | 3/3 | 3/3 | 3/3 | 3/3 |
| `q-latest-po` Latest PO (do not counter-question filter criteria) | 3/3 | 3/3 | 3/3 | 3/3 |
| `q-list-customers` List all customers | 3/3 | 3/3 | 3/3 | 3/3 |
| `q-low-stock` Products below inventory threshold | 3/3 | 3/3 | 3/3 | 3/3 |
| `q-no-id-leak` User asks for ID, must not leak UUID | 3/3 | 0/3 | 3/3 | 3/3 |
| `q-recent-shipping` Recent shipping records | 3/3 | 3/3 | 3/3 | 3/3 |
| `q-unpaid-orders` Unpaid orders (with filter parameters) | 3/3 | 3/3 | 3/3 | 3/3 |
| `r-after-confirmation` Post-confirmation next add request must actually create draft (2026-10-07 incident) | 3/3 | 3/3 | 3/3 | 3/3 |
| `r-duplicate-history` Duplicate messages in history (2026-10-07 incident) still respond properly | 0/3 | 3/3 | 2/3 | 3/3 |
| `r-entity-memory` Entity memory: Found customer last turn, create order using pronoun this turn (P0-4) | 3/3 | 3/3 | 3/3 | 3/3 |
| `r-multi-turn-order` Multi-turn order: Asked for customer name last turn, provide name only this turn | 0/3 | 0/3 | 2/3 | 0/3 |
| `w-create-order` Create order for existing customer | 3/3 | 3/3 | 3/3 | 3/3 |
| `w-create-po` Create PO (factory + product + quantity + unit price) | 3/3 | 3/3 | 3/3 | 3/3 |
| 🚧 `w-cross-domain-order` Cross-domain order: customer + factory + product (2026-10-07 incident raw prompt) | 0/3 | 3/3 | 3/3 | 0/3 |
| `w-order-unknown-customer` Ask whether to add when customer not found, do not create directly | 3/3 | 3/3 | 3/3 | 3/3 |

### 5.3 Observations

* **Single Agent × flash-lite falls short**: Providing all 17 tools simultaneously to flash-lite resulted in 30 MALFORMED_FUNCTION_CALL tool invocation errors, 3 calls to non-existent tools, 43% fallback rates, and 4% request failure rates. As tool counts grow, flash-lite becomes increasingly unstable.
* **flash-lite latency tail** (Router × flash-lite): 9 out of 84 runs exceeded 10 seconds, concentrated in 3 cases (`q-latest-po`, `pp-inventory`, `pp-unpaid`), taking ~15–28 seconds each. Step-by-step profiling shows time is spent in the sub-agent's **first step deciding to call tools** (emitting ~20 tokens while waiting 12–25 seconds). The Router itself takes ~1 second; there were no fallbacks and outputs were short, indicating provider-side waiting. The same issue does not occur with flash (max 5.7s). Exact root causes cannot be pulled from OpenRouter.
* **F1 (Router task rewriting loses info) is an architectural issue**: `r-duplicate-history` scored 3/3 across both Single Agent configurations while scoring 0/3 on Router × flash-lite. Single agents process raw messages directly, avoiding this issue.
* **Shared failure case `pp-create-po` across all configs**: User input "棉麻平织米白" (cotton-linen plain weave ecru with no spaces between name and color). Search relies on whitespace tokenization, failing to find the product. This is a search functionality issue (F15), unrelated to architecture.
* **`r-multi-turn-order`**: After finding the customer, the model asks for products and quantities before proceeding. `create_order` currently cannot take line items (Phase 1), making the model's follow-up questions logical.
* All four configurations maintained **0 business data writes and 0 UUID leaks** during AI workflows.

---

## 6. Decision

| Item | Content |
| --- | --- |
| **Selection** | Router × gemini-2.5-flash-lite (Same as current, no settings change required) |
| **Rationale** | Meets accuracy threshold at lowest cost |
| **Known Trade-offs** | 1 percentage point accuracy margin; ~10% of requests have 15–28s latency; F1 persists |
| **Preservation** | Single Agent implementation is retained and can be switched via configuration at any time (§7) without code modifications |

---

## 7. Next Steps & Re-evaluation Triggers

| Trigger | Action |
| --- | --- |
| Production accuracy or latency misses targets | Analyze actual latency and fallbacks via `query_traces`. If latency tails impact users, switch to Router × flash (approx. US$1.4 / 1k req) |
| Fixing F15 (space-less Chinese product searches) | Re-run evals; accuracy expected to rise across all configs |
| Adding tools in Phase 1 | Re-run evals upon completing each workflow; flash-lite stability may decline as tool counts increase (Single Agent × flash-lite already demonstrated this trend) |
| Requirement to resolve F1 | Single Agent structurally eliminates F1 but requires pairing with flash (approx. US$2.3 / 1k req) |

**Switching Methods** (No code changes required):

* **Architecture**: Set mcp-server environment variable `QUERY_AGENT_MODE=single` (default is `router`)
* **Primary Model**: Adjust `MODEL_PRIORITY` order in `mcp-server/src/agent/ai-gateway.ts`

**Re-running Evaluations** (Inside `mcp-server/`):

```bash
bun run eval -- --arch router --label <name>
bun run eval -- --arch single --primary google/gemini-2.5-flash --label <name>
```
