import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import type { Database } from '@/integrations/supabase/types';
import { EditableOrderItem, toEditableOrderItem, toOrderItemsPayload, useOrderItems } from '@/hooks/useOrderItems';
import { productLabel, useProductOptions } from '@/hooks/useProductOptions';
import { cancelOrder, updateOrder } from '@/lib/api/orders';
import { apiErrorMessage } from '@/lib/api/client';
import {
  ORDER_SHIPPING_STATUS_LABELS,
  ORDER_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  PURCHASE_STATUS_LABELS,
  statusLabel,
} from '@/lib/statusLabels';
import { RecordDialog } from '@/components/common/RecordDialog';
import { DetailSection } from '@/components/common/DetailSection';
import { DetailField } from '@/components/common/DetailField';
import { FormField } from '@/components/common/FormField';
import { CancelRecordButton } from '@/components/common/CancelRecordButton';
import { ProductLinesView } from '@/components/common/ProductLinesView';
import { OrderItemsEditor } from './OrderItemsEditor';

type OrderStatus = Database['public']['Enums']['order_status'];
type PaymentStatus = Database['public']['Enums']['payment_status'];
type ShippingStatus = Database['public']['Enums']['shipping_status'];

// The order fields the dialog shows; the list row has more
export interface OrderRecord {
  id: string;
  organization_id: string;
  order_number: string;
  status: string;
  payment_status: string;
  shipping_status: string;
  note: string | null;
  created_at: string;
  user_id?: string | null;
  cancel_reason?: string | null;
  customers?: { name: string } | null;
}

interface OrderDialogProps {
  // Pass the row from the latest list data so the view shows saved changes
  order: OrderRecord;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canEdit: boolean;
}

const EDITABLE_ORDER_STATUSES: OrderStatus[] = ['pending', 'confirmed', 'factory_ordered', 'completed'];

export const OrderDialog: React.FC<OrderDialogProps> = ({ order, open, onOpenChange, canEdit }) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  // Cancelled orders are frozen; nobody can edit them
  const isCancelled = order.status === 'cancelled';
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState<OrderStatus>(order.status as OrderStatus);
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>(order.payment_status as PaymentStatus);
  const [shippingStatus, setShippingStatus] = useState<ShippingStatus>(order.shipping_status as ShippingStatus);
  const [note, setNote] = useState(order.note || '');
  const [items, setItems] = useState<EditableOrderItem[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);

  const { data: itemRows } = useOrderItems(order.id, open);
  const { data: products = [] } = useProductOptions(order.organization_id);

  useEffect(() => {
    if (open) setEditing(false);
  }, [open, order.id]);

  const startEditing = () => {
    setStatus(order.status as OrderStatus);
    setPaymentStatus(order.payment_status as PaymentStatus);
    setShippingStatus(order.shipping_status as ShippingStatus);
    setNote(order.note || '');
    setItems((itemRows ?? []).map(toEditableOrderItem));
    setSaveError(null);
    setEditing(true);
  };

  const cancelEditing = () => {
    setSaveError(null);
    setEditing(false);
  };

  // Purchase orders linked to this order and its shippings
  const { data: relatedData } = useQuery({
    queryKey: ['order-related-data', order.id],
    queryFn: async () => {
      const { data: links, error: poError } = await supabase
        .from('purchase_order_relations')
        .select(`
          purchase_orders (
            *,
            factories (name),
            purchase_order_items (
              *,
              products_new (name, color)
            )
          )
        `)
        .eq('order_id', order.id);
      if (poError) throw poError;
      const purchaseOrders = (links ?? []).map((link) => link.purchase_orders).filter((po) => po !== null);

      const { data: shippings, error: shippingError } = await supabase
        .from('shippings')
        .select('*')
        .eq('order_id', order.id);
      if (shippingError) throw shippingError;

      return { purchaseOrders: purchaseOrders || [], shippings: shippings || [] };
    },
    enabled: open,
  });

  // Products already on a live purchase order for this order are locked in the editor
  const purchasedProductIds = useMemo(
    () =>
      new Set<string>(
        (relatedData?.purchaseOrders ?? [])
          .filter((po) => po.status !== 'cancelled')
          .flatMap((po) => (po.purchase_order_items ?? []).map((item) => item.product_id)),
      ),
    [relatedData],
  );

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['orders'] });
    queryClient.invalidateQueries({ queryKey: ['order-items', order.id] });
    queryClient.invalidateQueries({ queryKey: ['order-related-data', order.id] });
    queryClient.invalidateQueries({ queryKey: ['record-audit-logs', order.id] });
  };

  const updateOrderMutation = useMutation({
    mutationFn: async () => {
      // One call saves the lines, statuses and note together; the database checks the lock rules
      await updateOrder(order.organization_id, order.id, {
        status: status as Exclude<OrderStatus, 'cancelled'>,
        payment_status: paymentStatus,
        // The item save recalculates shipping status; only override it when the user changed it here
        ...(shippingStatus !== order.shipping_status ? { shipping_status: shippingStatus } : {}),
        note,
        items: toOrderItemsPayload(items),
      });
    },
    onSuccess: () => {
      toast({ title: '成功', description: '訂單已成功更新' });
      refresh();
      setEditing(false);
    },
    onError: (error: Error) => setSaveError(apiErrorMessage(error, '更新訂單時發生錯誤')),
  });

  // Cancelling is refused once the order has shipments or live purchase orders
  const cancelOrderMutation = useMutation({
    mutationFn: (reason: string) => cancelOrder(order.organization_id, order.id, reason),
    onSuccess: () => {
      toast({ title: '成功', description: `訂單 ${order.order_number} 已取消` });
      refresh();
      setEditing(false);
    },
    onError: (error: Error) => setSaveError(apiErrorMessage(error, '取消訂單時發生錯誤')),
  });

  const handleSubmit = () => {
    if (items.length === 0) {
      setSaveError('訂單至少需要一項產品');
      return;
    }
    if (items.some((item) => !item.product_id)) {
      setSaveError('請為每一項選擇產品');
      return;
    }
    if (items.some((item) => !(Number(item.quantity) > 0) || item.unit_price === '' || Number(item.unit_price) < 0)) {
      setSaveError('請填寫正確的數量與單價');
      return;
    }
    setSaveError(null);
    updateOrderMutation.mutate();
  };

  const productName = (productId: string) => {
    const product = products.find((option) => option.id === productId);
    return product ? productLabel(product) : '';
  };

  const viewLines = (itemRows ?? []).map((row) => ({
    key: row.id,
    product: productName(row.product_id),
    quantity: Number(row.quantity),
    unitPrice: Number(row.unit_price),
    notes: Number(row.shipped_quantity) > 0 ? [`已出貨 ${Number(row.shipped_quantity)} 公斤`] : [],
  }));

  return (
    <RecordDialog
      open={open}
      onOpenChange={onOpenChange}
      mode={editing ? 'edit' : 'view'}
      title={editing ? '編輯訂單' : '訂單詳情'}
      description={`訂單編號：${order.order_number}`}
      size="xl"
      history={{ recordId: order.id, creation: { tableName: 'orders', createdBy: order.user_id ?? null, createdAt: order.created_at } }}
      onEdit={canEdit && !isCancelled ? startEditing : undefined}
      onCancelEdit={cancelEditing}
      onSubmit={handleSubmit}
      submitting={updateOrderMutation.isPending}
      error={saveError}
      editActions={
        <CancelRecordButton
          label="取消訂單"
          subject={order.order_number}
          description="取消後訂單不能再修改。已有出貨紀錄或進行中採購單的訂單無法取消。"
          pending={cancelOrderMutation.isPending}
          onConfirm={(reason) => cancelOrderMutation.mutateAsync(reason).catch(() => undefined)}
        />
      }
    >
      {isCancelled && (
        <p className="rounded-md border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
          此訂單已取消{order.cancel_reason ? `，原因：${order.cancel_reason}` : ''}，不能再修改。
        </p>
      )}

      {editing ? (
        <>
          <DetailSection title="基本資訊" fields>
            <DetailField label="客戶">{order.customers?.name}</DetailField>
            <DetailField label="建立時間">{new Date(order.created_at).toLocaleString('zh-TW')}</DetailField>
          </DetailSection>

          <DetailSection title="狀態">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <FormField label="訂單狀態" htmlFor="order-status">
                <Select value={status} onValueChange={(value: OrderStatus) => setStatus(value)}>
                  <SelectTrigger id="order-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EDITABLE_ORDER_STATUSES.map((value) => (
                      <SelectItem key={value} value={value}>
                        {ORDER_STATUS_LABELS[value]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
              <FormField label="付款狀態" htmlFor="order-payment-status">
                <Select value={paymentStatus} onValueChange={(value: PaymentStatus) => setPaymentStatus(value)}>
                  <SelectTrigger id="order-payment-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(PAYMENT_STATUS_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
              <FormField label="出貨狀態" htmlFor="order-shipping-status">
                <Select value={shippingStatus} onValueChange={(value: ShippingStatus) => setShippingStatus(value)}>
                  <SelectTrigger id="order-shipping-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(ORDER_SHIPPING_STATUS_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            </div>
          </DetailSection>

          <DetailSection title="訂單產品">
            <OrderItemsEditor items={items} onChange={setItems} products={products} purchasedProductIds={purchasedProductIds} />
          </DetailSection>

          <FormField label="訂單備註" htmlFor="order-note">
            <Textarea id="order-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="輸入訂單備註..." />
          </FormField>
        </>
      ) : (
        <>
          <DetailSection title="基本資訊" fields>
            <DetailField label="客戶">{order.customers?.name}</DetailField>
            <DetailField label="訂單狀態">{statusLabel(ORDER_STATUS_LABELS, order.status)}</DetailField>
            <DetailField label="付款狀態">{statusLabel(PAYMENT_STATUS_LABELS, order.payment_status)}</DetailField>
            <DetailField label="出貨狀態">{statusLabel(ORDER_SHIPPING_STATUS_LABELS, order.shipping_status)}</DetailField>
            <DetailField label="建立時間">{new Date(order.created_at).toLocaleString('zh-TW')}</DetailField>
            <DetailField label="訂單備註" wide>{order.note}</DetailField>
          </DetailSection>

          <DetailSection title="訂單產品">
            <ProductLinesView lines={viewLines} quantityLabel="數量（公斤）" totalLabel="訂單總額" />
          </DetailSection>

          {relatedData && relatedData.purchaseOrders.length > 0 && (
            <DetailSection title="關聯採購單">
              <div className="space-y-2">
                {relatedData.purchaseOrders.map((po) => (
                  <div key={po.id} className="flex items-center justify-between rounded-md border border-gray-200 p-3 text-sm">
                    <div>
                      <div className="font-medium text-gray-900">{po.po_number}</div>
                      <div className="text-gray-600">工廠：{po.factories?.name ?? '-'}</div>
                    </div>
                    <div className="text-right">
                      <Badge variant="outline">{statusLabel(PURCHASE_STATUS_LABELS, po.status)}</Badge>
                      <div className="mt-1 text-xs text-gray-500">{new Date(po.order_date).toLocaleDateString('zh-TW')}</div>
                    </div>
                  </div>
                ))}
              </div>
            </DetailSection>
          )}

          {relatedData && relatedData.shippings.length > 0 && (
            <DetailSection title="出貨紀錄">
              <div className="space-y-2">
                {relatedData.shippings.map((shipping) => (
                  <div key={shipping.id} className="flex items-center justify-between rounded-md border border-gray-200 p-3 text-sm">
                    <div>
                      <div className="font-medium text-gray-900">{shipping.shipping_number}</div>
                      <div className="text-gray-600">
                        {shipping.total_shipped_quantity} 公斤，{shipping.total_shipped_rolls} 卷
                        {shipping.status === 'cancelled' && '（已取消）'}
                      </div>
                    </div>
                    <div className="text-xs text-gray-500">{new Date(shipping.shipping_date).toLocaleDateString('zh-TW')}</div>
                  </div>
                ))}
              </div>
            </DetailSection>
          )}
        </>
      )}
    </RecordDialog>
  );
};
