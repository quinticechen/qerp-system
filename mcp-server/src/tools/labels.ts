/** Display labels for enum values shown on confirmation cards (UI text is Traditional Chinese). */

export const ORDER_STATUS_LABELS: Record<string, string> = {
  pending: "待確認",
  confirmed: "已確認",
  factory_ordered: "已向工廠下單",
  completed: "已完成",
  cancelled: "已取消",
};

export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  unpaid: "未付款",
  partial_paid: "部分付款",
  paid: "已付清",
};

export const SHIPPING_STATUS_LABELS: Record<string, string> = {
  not_started: "未出貨",
  partial_shipped: "部分出貨",
  shipped: "已出貨",
};

/** Card fields, skipping empty values. */
export function fields(entries: [label: string, value: string | null | undefined][]): { label: string; value: string }[] {
  return entries.filter((e): e is [string, string] => !!e[1]).map(([label, value]) => ({ label, value }));
}
