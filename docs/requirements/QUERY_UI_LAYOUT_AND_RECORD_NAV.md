# Query: Open the Record After Confirming, and Desktop Display Modes

> Status: done (2026-10-15). Owner: AI Session (Query frontend); opening records from the URL on the business pages was implemented by the AI Session on the RBAC Session's behalf (the RBAC Session was idle and the user asked directly), see [SESSION_COORDINATION.md](../SESSION_COORDINATION.md) §6.
> Supersedes the 2026-10-14 "jump to a record preview" decision in [QUERY_AGENT_TPM_ALIGNMENT.md](./QUERY_AGENT_TPM_ALIGNMENT.md) §3.2.
> Update on completion: [FEATURES.md](../FEATURES.md) §5, [AGENT.md](../AGENT.md).

## 1. Open the record just written after confirming

### 1.1 Flow

1. When all required fields are present, the Agent creates a draft, and a confirmation card with "Confirm" and "Cancel" appears in the conversation
2. The user presses "Confirm" → the backend writes through the business API (`POST /query/actions/:id/confirm`, as today)
3. After a successful write, the ERP switches to the page the record belongs to and opens that record's dialog (view mode). For example, creating an order → `/order`, opening the new order
4. Pressing "Cancel", an expired draft, or a failed write does not switch pages

### 1.2 Tools to pages

The confirm response carries the written record's `id` (returned by the business API, [API.md](../API.md) §2.2).

| Tool | Page | Opens |
|------|------|-------|
| `create_customer`, `update_customer`, `set_customer_active` | `/customer` | Customer |
| `create_factory`, `update_factory`, `set_factory_active` | `/factory` | Factory |
| `create_order`, `update_order_status`, `update_order`, `cancel_order` | `/order` | Order |
| `create_purchase_order`, `update_purchase_order`, `cancel_purchase_order` | `/purchase` | Purchase order |
| `receive_inventory`, `update_inventory` | `/inventory` (receiving records tab) | Receipt |
| `update_inventory_roll` | `/inventory` | Nothing (rolls have no dialog of their own) |
| `create_shipping`, `update_shipping`, `cancel_shipping` | `/shipping` | Shipping |
| `create_product`, `update_product`, `set_product_active` | `/product` | Product |
| `add_product_color`, `update_product_color`, `set_product_color_active` | `/product` | Color |
| `create_shelf`, `update_shelf`, `set_shelf_active` | `/shelf` | Shelf |

### 1.3 How a page opens a record

The URL carries `?open=<record id>` (receiving also carries `tab=records`). The page reads it, opens that record's dialog, and removes the parameters from the URL so a refresh or going back doesn't open it again. If the record hasn't loaded yet, it opens once the data arrives; if it isn't in the current list (for example, filtered out), it doesn't open.

### 1.4 The Query panel's part

- Floating, sidebar: the panel stays open after the page switch, so the user can keep chatting
- Full screen: switches to the sidebar after the page switch, so the user can see the opened record
- Mobile: closes the chat page and returns to that ERP page

## 2. Desktop display modes

| Mode | Layout | Default |
|------|--------|---------|
| Floating | As it is now: a 380×580 panel at the bottom right | ✅ |
| Sidebar | Query takes the full height on the right, and the whole ERP shrinks to the left instead of being covered; width defaults to the same as floating (380px), resized by dragging the left edge (320px to half the screen width) | |
| Full screen | Query fills the whole screen | |

- Buttons on the right of the title bar, left to right: History, Display mode, New conversation, Delete conversation, Close (specified by the user on 2026-10-15). The "Display mode" icon shows the current mode, and clicking it reveals three icons to switch between; every button is icon-only, with the name in `aria-label` and `title`
- Deleting a conversation (from the title bar or in History) asks the user to confirm and explains it cannot be undone
- Remember the user's last mode and sidebar width (in the browser's local storage; use the defaults if they can't be read)
- While the sidebar or full screen is open, the Query button at the bottom right is hidden; close it with the title bar's Close button
- Mobile keeps the current full-screen chat page and offers no switching

## 3. Verification

- `scripts/verify-query-ui.py` (opening/closing the Query panel, chatting)
- Frontend type check and build
- Manual: switching the three display modes, dragging the sidebar, jumping to the page and opening the record after confirming a card (order, customer, product color, receiving)
