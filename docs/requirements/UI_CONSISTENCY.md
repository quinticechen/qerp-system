# UI Consistency Rules

> Requirement document (RBAC Session). Status: done (2026-10-09). User decision: the record dialogs on every page look and behave the same, written down as a rule.

## 1. Record dialog (view, edit, create)

Every record (customers, factories, products, colors, shelves, orders, purchase orders, receiving records, rolls, shippings, users) opens in the same component, `RecordDialog` (`src/components/common/RecordDialog.tsx`), which has three modes:

| Mode | Top right | Content | Bottom left | Bottom right |
|------|-----------|---------|-------------|--------------|
| View (always the mode on open) | Edit history, Close | All fields; empty ones show "-" | — | Edit (only with permission, and only if the record is not voided) |
| Edit (after pressing "Edit") | Close | The same form as Create | Void (documents) or Deactivate / Activate (master data, members) | Cancel, Update |
| Create | Close | Form | — | Cancel, Create |

- "Cancel" returns to View and discards the changes; pressing "Close" while editing also discards the changes.
- After a successful update, the dialog returns to View mode without closing and shows the updated data (the list passes in the latest data by id).
- Voided documents have no "Edit" button.
- The dialog's content area scrolls while the title and bottom buttons stay fixed, so no amount of content overflows the screen.
- Action buttons (Edit, Void, Deactivate / Activate, Edit history) are icon-only, with the name in `aria-label` and `title`; form submit buttons (Cancel, Update, Create) use text.

Dialogs that are not about a record are exempt: confirmation steps (transfer ownership, delete organization), forgot password, and change password in personal settings.

## 2. Shared components

| Component | Purpose |
|-----------|---------|
| `RecordDialog` | The layout for the three modes above |
| `DetailSection` | Section heading (`text-base font-semibold`); with `fields`, a two-column field list |
| `DetailField` | One field in View mode: label `text-sm font-medium text-gray-600`, value `text-sm text-gray-900` |
| `FormField` | One field in Edit and Create mode: the same label style as `DetailField`, plus the required asterisk, hint and error |
| `ActiveToggleButton` | Deactivate / Activate (bottom left in Edit mode) |
| `CancelRecordButton` | Void a document, with a cancel-reason confirmation (bottom left in Edit mode) |
| `ProductLinesView` | Product lines of orders and purchase orders (View mode) |
| `NumberInput` | Every number field: accepts digits only, empty by default, can be cleared, and the mouse wheel does not change the value |
| `RecordIdButton` | The record ID icon at the top right of an edit-history card; appears on hover, copies on click |

Section headings in create forms use `Label` (the same as the new-order form), not `CardTitle` (too large).

## 3. Fixes made in the same change

- New customers and factories appear in the list immediately (no refresh needed).
- Customer and factory details show every field.
- Order and purchase order lists gain a "Note" column; the purchase order list gains "Latest receiving", and the details show, for each product, the quantity received and the receiving date, and list the receiving records.
- Receiving record details drop the empty "Person in charge" field.
- "Add customer" and "Add factory" in the new-order form became icon buttons.
- When inviting a new user, the phone number is written at sign-up (`supabase/migrations/20261009163659_signup_profile_phone.sql`), so the edit history no longer gets an extra "修改用戶資料" (user profile changed) entry.
- The record ID in the edit history became an icon at the top right of the card.
- Status text comes from `src/lib/statusLabels.ts` everywhere, so pages, record dialogs and the edit history use the same words.
