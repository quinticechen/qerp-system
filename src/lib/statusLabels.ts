// Status wording shown on pages, in record dialogs and in the edit history

export const ORDER_STATUS_LABELS: Record<string, string> = {
  pending: '待處理',
  confirmed: '已確認',
  factory_ordered: '已向工廠下單',
  completed: '已完成',
  cancelled: '已取消',
};

export const PAYMENT_STATUS_LABELS: Record<string, string> = { unpaid: '未付款', partial_paid: '部分付款', paid: '已付款' };

export const ORDER_SHIPPING_STATUS_LABELS: Record<string, string> = { not_started: '未開始', partial_shipped: '部分出貨', shipped: '已出貨' };

export const PURCHASE_STATUS_LABELS: Record<string, string> = {
  pending: '待確認',
  confirmed: '已下單',
  partial_arrived: '部分到貨',
  partial_received: '部分入庫',
  completed: '已完成',
  cancelled: '已取消',
};

export const SHIPPING_STATUS_LABELS: Record<string, string> = { shipped: '已出貨', cancelled: '已取消' };

export const statusLabel = (labels: Record<string, string>, value: string | null | undefined) =>
  value ? labels[value] ?? value : '-';
