// Receiving batches of a purchase order, as loaded with the purchase order list
export interface PurchaseReceipt {
  arrival_date: string | null;
  receipt_number: string | null;
  inventory_rolls?: { product_id: string }[] | null;
}

// The most recent arrival date of a purchase order, or null before anything arrived
export const lastArrivalDate = (receipts: PurchaseReceipt[] | null | undefined): string | null =>
  (receipts ?? [])
    .map((receipt) => receipt.arrival_date)
    .filter((date): date is string => !!date)
    .sort()
    .at(-1) ?? null;

// The arrival dates on which a product of the purchase order was received, oldest first
export const arrivalDatesOf = (receipts: PurchaseReceipt[] | null | undefined, productId: string): string[] =>
  [
    ...new Set(
      (receipts ?? [])
        .filter((receipt) => receipt.arrival_date && (receipt.inventory_rolls ?? []).some((roll) => roll.product_id === productId))
        .map((receipt) => receipt.arrival_date as string),
    ),
  ].sort();
