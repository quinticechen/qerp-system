# Features

> Current-state document (2026-10-09). Each feature is available by role, see [PERMISSIONS.md](./PERMISSIONS.md); all data writes go through the business APIs in [API.md](./API.md).

## 1. Accounts and organizations

| Feature | Page | Description |
|---------|------|-------------|
| Sign in, sign up, forgot password | `/login`, `/reset-password` | Email/password or Google sign-in |
| Personal settings | Top-right menu | Name, phone |
| Create organization, switch organization | `/create-organization`, top-right menu | The creator becomes the owner; one account can belong to several organizations |
| Accept invitation | `/accept-invitation`, invitation card on the dashboard | |
| User management | `/user` | Invite members, change roles, deactivate (in the member's edit mode), resend invitations, view the activity log |
| Permission guide | `/permission`, `/organization-roles` | The four fixed roles and what each can use |
| Organization settings | `/system` | Transfer ownership, delete organization (owner). The other settings cards are not implemented yet and are hidden in production (CLAUDE.md "Unfinished Features") |

## 2. Master data

| Feature | Page | Description |
|---------|------|-------------|
| Products | `/product` | Two levels: product (name, category, unit) and color (color, color code, color value, safety stock). Expand a row to see each color's stock and low-stock warning; products and colors are edited and deactivated separately, each with its own edit history |
| Customers | `/customer` | Contact details; once deactivated, they don't appear in new orders |
| Factories | `/factory` | Same as customers; once deactivated, they can't be assigned to new orders or purchase orders |
| Shelves | `/shelf` | Name, location, the rolls currently stored; once deactivated, no new rolls can be placed |

## 3. From order to shipping

| Feature | Page | Description |
|---------|------|-------------|
| Orders | `/order` | Customer, line items (product color, kilograms, unit price, rolls, specification), assigned factories, note; status, payment status; shipping progress is computed automatically. Shipped or purchased lines are locked; an order can be cancelled (when it has no shippings and no active purchase orders) |
| Purchasing | `/purchase` | Place purchase orders with factories and link them to orders (the orders automatically become 「已向工廠下單」, ordered from factory); a list awaiting receipt. Receiving progress is computed automatically; the list shows the latest receiving date, and the details show each product's received quantity and receiving dates; cancellable until goods are received |
| Receiving | `/inventory` | Receive against a purchase order, recording each roll's weight, grade, shelf and position; receipt numbers and roll numbers are generated automatically. Over-receiving shows a warning |
| Inventory | `/inventory` | Stock per product, grade breakdown, awaiting receipt, awaiting shipment; roll details for each product; edit a roll's weight, grade and position |
| Shipping | `/shipping` | Ship rolls against an order, deducting stock and updating the order's shipping progress; can be edited or cancelled (stock is returned) |

Common to all:

- Clicking a record in a list opens it in view mode; editing requires pressing "Edit", and the bottom left of edit mode holds Void or Deactivate / Activate ([requirements/UI_CONSISTENCY.md](./requirements/UI_CONSISTENCY.md)). Order, purchase order, receiving and shipping lists all have a note column.
- Number fields accept digits only and are empty by default.
- Document numbers are "letter + date + sequence number": orders B, purchase orders P, receipts I, shippings O ([API.md](./API.md) §2.5).
- Every document and master record has an "Edit history" showing who changed what and when.
- Actions blocked by a rule show the reason in Chinese (for example 「已有入庫紀錄，不能取消」, "already received, can't cancel").

## 4. Dashboard (`/dashboard`)

Stat cards (orders, products in stock, customers, awaiting shipment), recent orders, and quick actions shown by permission. The "vs last month" change on the stat cards is not implemented yet and is hidden in production.

## 5. AI query assistant

The Query button at the bottom right: ask about and operate on customers, factories, products, shelves, orders, purchasing, receiving, inventory and shipping in Chinese. For any create, edit, deactivate or cancel, the AI first shows a confirmation card, and nothing is written until the user presses "Confirm"; after the write, the ERP switches to that record's page and opens it (for example, after creating an order it opens that order on `/order`). For the architecture and planning, see [AGENT.md](./AGENT.md).

Each AI reply has thumbs-up and thumbs-down icon buttons beneath it; pressing again undoes it. The feedback is used to improve Query ([AGENT.md](./AGENT.md)).

The buttons on the right of the Query title bar, left to right: History (conversation list; pin, delete), Display mode (desktop), New conversation, Delete conversation, Close. Deleting a conversation asks the user to confirm and cannot be undone.

On desktop, clicking "Display mode" (its icon shows the current mode) offers these three, and the last choice is remembered:

| Mode | Layout |
|------|--------|
| Floating window (default) | A 380×580 panel at the bottom right |
| Sidebar | Full height on the right, with the ERP shrinking to the left; drag the left edge to resize (320px to half the screen) |
| Full screen | Fills the whole screen; after confirming a write, switches to the sidebar so the opened record is visible |

On mobile it is a full-screen chat page; use the back button or swipe from the left edge to return to the ERP.

Each page can open a record from the URL: `?open=<record id>` (receiving records also add `tab=records`); the parameters are removed from the URL once it opens.
