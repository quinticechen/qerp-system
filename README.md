# Weave Flow ERP (紡織業 ERP)

An ERP for textile businesses that sell fabric by the kilogram and the roll. It follows each deal from the customer's order, to the purchase order placed with a factory, to the rolls arriving in the warehouse, to the shipment going out. It also includes **Query**, an AI assistant that looks up and enters data through a conversation in Chinese.

The app's interface is in Traditional Chinese.

## Who it's for

A small or mid-sized textile trader, where several people handle the same order at different stages:

| Person | What they do in Weave Flow |
|--------|----------------------------|
| Sales | Keep customer details, take orders, check whether stock can cover an order |
| Purchasing | Place purchase orders with factories for what the orders need, and track what's still on its way |
| Warehouse | Receive rolls (weight, grade, shelf), keep stock accurate, ship rolls against orders |
| Owner and managers | See the whole picture on the dashboard, invite the team and decide who can do what |

## The problem it solves

Without one shared system, each step of an order lives in a different spreadsheet, chat or notebook. It's hard to answer simple questions: Has this order been placed with a factory? How much of it has arrived? Can we ship it today? Weave Flow keeps every step in one place and links them. An order shows its purchasing and shipping progress, and stock updates itself as rolls arrive and leave.

## What you can do

### Run an order from start to finish

1. **Take the order**: customer, fabric and color, kilograms, unit price, number of rolls, and which factories will produce it.
2. **Purchase from factories**: place purchase orders linked to the order. The order shows 「已向工廠下單」 (ordered from factory) on its own.
3. **Receive the goods**: record each roll's weight, grade and shelf as it arrives. Receipt and roll numbers are created for you, and over-receiving shows a warning.
4. **Ship**: pick the rolls to send. Stock goes down and the order's shipping progress updates. A cancelled shipment returns the rolls to stock.

Along the way, **Inventory** shows the stock of each fabric and color, by grade, plus what's still awaiting receipt or shipment, with a warning when a color falls below its safety stock.

### Keep your master data

Products (each fabric with its colors), customers, factories and warehouse shelves. A customer or factory you stop working with is deactivated, not deleted, so old orders still show who they were for.

### Ask Query instead of clicking through screens

The Query button at the bottom right of every page opens a chat. Type a request in Chinese, for example:

- 「目前有哪些庫存低於門檻？」 (Which stock is below its threshold?)
- 「禾境紡研的訂單，現在的庫存夠不夠出貨？」 (Is there enough stock to ship 禾境紡研's order?)
- 「幫客戶王小姐建立新的訂單…」 (Create a new order for customer Ms. Wang…)

Query can look up anything you can see, and can create, edit, deactivate or cancel records across every area above. **It never changes data on its own.** It first shows a confirmation card, and nothing is saved until you press "Confirm". Then the ERP opens the record it just saved, so you can check it.

Query only sees the current organization, and only does what your role allows. On desktop it can be a floating window, a sidebar beside the ERP, or full screen. Conversations are kept in a history list. A thumbs up or down under each reply tells the team which answers to improve.

### Work as a team

- **Organizations**: each business is its own organization, and its data is never visible to others. One person can belong to several organizations and switch between them.
- **Invitations**: the owner or an admin invites colleagues by email.
- **Four fixed roles**:

| Role | Can do |
|------|--------|
| Owner | Everything, plus transfer ownership or delete the organization |
| Admin | All business features, plus managing members and organization settings |
| Editor | View, create and edit business data |
| Viewer | View business data only |

## How it behaves

- **Nothing is deleted.** Master data is deactivated and documents are cancelled, so history stays complete.
- **Every change is on record.** Each document and record has an edit history of who changed what, and when.
- **Rules are enforced, and explained.** For example, a purchase order that has already received goods can't be cancelled. The app says why in plain Chinese, such as 「已有入庫紀錄，不能取消」 (already received, can't cancel).
- **Readable document numbers.** A letter plus the date and a sequence number: orders B, purchase orders P, receipts I, shipments O.
- **No dead buttons.** Features that aren't finished yet are hidden in production.

## Status

The order-to-shipping flow, master data, organizations and roles are in use, and the public Home page takes free-trial requests. Query is live and still improving. The current goals are to complete tasks at least 40% faster than clicking through the screens, with replies that are over 85% accurate and arrive in under 10 seconds. Organization settings other than transferring ownership and deleting the organization, and the month-on-month change on the dashboard, are not built yet.

## Documentation

| Document | What it covers |
|----------|----------------|
| [FEATURES.md](./docs/FEATURES.md) | Every feature and the page it lives on |
| [PERMISSIONS.md](./docs/PERMISSIONS.md) | Roles and what each one can do |
| [AGENT.md](./docs/AGENT.md) | How Query works, its tools and known issues |
| [TECH_STACK.md](./docs/TECH_STACK.md) | Architecture, code layout and how to run the project |
| [API.md](./docs/API.md) | Business APIs, organization and member RPCs, Query server endpoints |
| [DATABASE_TABLES.md](./docs/DATABASE_TABLES.md) | Tables and business rules |
| [SERVICES.md](./docs/SERVICES.md) | External services and environments |
| [DEPENDENCIES.md](./docs/DEPENDENCIES.md) | Packages |
| [EVALS.md](./docs/EVALS.md), [QUERY_AGENT_EVALS.md](./docs/QUERY_AGENT_EVALS.md) | How Query's answers are tested, and the results |
| [requirements/](./docs/requirements/README.md) | Product requirements, plans and decisions |

To try QERP, press 「免費試用」 (free trial) on [qerp.qwizai.com](https://qerp.qwizai.com) and leave your details; the team calls back and opens your account.

Developers should start with [TECH_STACK.md](./docs/TECH_STACK.md) and [CLAUDE.md](./CLAUDE.md).
