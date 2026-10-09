import React, { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import {
  EditablePurchaseOrderItem,
  toEditablePurchaseOrderItem,
  toPurchaseOrderItemsPayload,
  usePurchaseOrderItems,
} from '@/hooks/usePurchaseOrderItems';
import { productLabel, useProductOptions } from '@/hooks/useProductOptions';
import { cancelPurchaseOrder, updatePurchaseOrder, type PurchaseOrderChanges } from '@/lib/api/purchases';
import { apiErrorMessage } from '@/lib/api/client';
import { arrivalDatesOf, lastArrivalDate, type PurchaseReceipt } from '@/lib/purchaseArrivals';
import { PURCHASE_STATUS_LABELS, statusLabel } from '@/lib/statusLabels';
import { RecordDialog } from '@/components/common/RecordDialog';
import { DetailSection } from '@/components/common/DetailSection';
import { DetailField } from '@/components/common/DetailField';
import { FormField } from '@/components/common/FormField';
import { CancelRecordButton } from '@/components/common/CancelRecordButton';
import { ProductLinesView } from '@/components/common/ProductLinesView';
import { PurchaseLineItemsEditor } from './PurchaseLineItemsEditor';

type EditableStatus = NonNullable<PurchaseOrderChanges['status']>;

const EDITABLE_STATUSES: EditableStatus[] = ['pending', 'confirmed', 'partial_received', 'completed'];

// The purchase order fields the dialog shows; the list row has more
export interface PurchaseRecord {
  id: string;
  organization_id: string;
  po_number: string;
  status: string;
  note: string | null;
  expected_arrival_date?: string | null;
  order_date?: string | null;
  created_at?: string;
  user_id?: string | null;
  cancel_reason?: string | null;
  factories?: { name: string } | null;
  inventories?: PurchaseReceipt[] | null;
  purchase_order_relations?: { orders: { order_number: string; note: string | null } | null }[] | null;
}

interface PurchaseDialogProps {
  // Pass the row from the latest list data so the view shows saved changes
  purchase: PurchaseRecord;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canEdit: boolean;
}

const formatDate = (value: string | null | undefined) => (value ? new Date(value).toLocaleDateString('zh-TW') : null);

export const PurchaseDialog = ({ purchase, open, onOpenChange, canEdit }: PurchaseDialogProps) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  // Cancelled purchase orders are frozen; nobody can edit them
  const isCancelled = purchase.status === 'cancelled';
  const [editing, setEditing] = useState(false);
  const [expectedArrivalDate, setExpectedArrivalDate] = useState('');
  const [note, setNote] = useState('');
  const [status, setStatus] = useState<EditableStatus>('pending');
  const [items, setItems] = useState<EditablePurchaseOrderItem[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);

  const { data: itemRows } = usePurchaseOrderItems(purchase.id, open);
  const { data: products = [] } = useProductOptions(purchase.organization_id);
  const receipts: PurchaseReceipt[] = purchase.inventories ?? [];

  useEffect(() => {
    if (open) setEditing(false);
  }, [open, purchase.id]);

  const startEditing = () => {
    setExpectedArrivalDate(purchase.expected_arrival_date || '');
    setNote(purchase.note || '');
    setStatus((purchase.status === 'partial_arrived' ? 'confirmed' : purchase.status || 'pending') as EditableStatus);
    setItems((itemRows ?? []).map(toEditablePurchaseOrderItem));
    setSaveError(null);
    setEditing(true);
  };

  const cancelEditing = () => {
    setSaveError(null);
    setEditing(false);
  };

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['purchases'] });
    queryClient.invalidateQueries({ queryKey: ['pending-inventory'] });
    queryClient.invalidateQueries({ queryKey: ['purchase-order-items', purchase.id] });
    queryClient.invalidateQueries({ queryKey: ['record-audit-logs', purchase.id] });
  };

  const updatePurchaseMutation = useMutation({
    mutationFn: () =>
      // One call saves the items, dates, note and status together; the database checks the lock rules
      updatePurchaseOrder(purchase.organization_id, purchase.id, {
        items: toPurchaseOrderItemsPayload(items),
        expected_arrival_date: expectedArrivalDate,
        note,
        // The item save recalculates status; only override it when the user changed it here
        ...(status !== purchase.status ? { status } : {}),
      }),
    onSuccess: () => {
      toast({ title: '成功', description: '採購單已更新' });
      refresh();
      setEditing(false);
    },
    onError: (error: Error) => setSaveError(apiErrorMessage(error, '更新採購單失敗')),
  });

  // Cancelling is refused once goods have been received against the purchase order
  const cancelPurchaseMutation = useMutation({
    mutationFn: (reason: string) => cancelPurchaseOrder(purchase.organization_id, purchase.id, reason),
    onSuccess: () => {
      toast({ title: '成功', description: `採購單 ${purchase.po_number} 已取消` });
      refresh();
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      setEditing(false);
    },
    onError: (error: Error) => setSaveError(apiErrorMessage(error, '取消採購單失敗')),
  });

  const handleSubmit = () => {
    if (items.length === 0) {
      setSaveError('採購單至少需要一項產品');
      return;
    }
    if (items.some((item) => !item.product_id)) {
      setSaveError('請為每一項選擇產品');
      return;
    }
    if (items.some((item) => !(Number(item.quantity) > 0) || item.unit_price === '' || Number(item.unit_price) < 0)) {
      setSaveError('請填寫正確的採購數量與單價');
      return;
    }
    setSaveError(null);
    updatePurchaseMutation.mutate();
  };

  const productName = (productId: string) => {
    const product = products.find((option) => option.id === productId);
    return product ? productLabel(product) : '';
  };

  // Each product shows what has been received and on which dates
  const viewLines = (itemRows ?? []).map((row) => {
    const received = Number(row.received_quantity ?? 0);
    const dates = arrivalDatesOf(receipts, row.product_id).map((date) => `入庫 ${formatDate(date)}`);
    return {
      key: row.id,
      product: productName(row.product_id),
      quantity: Number(row.ordered_quantity),
      unitPrice: Number(row.unit_price),
      rolls: row.ordered_rolls,
      notes: [...(received > 0 ? [`已入庫 ${received} 公斤`] : []), ...dates],
    };
  });

  const relatedOrders = (purchase.purchase_order_relations ?? [])
    .map((relation) => relation.orders)
    .filter((order): order is { order_number: string; note: string | null } => order !== null);

  return (
    <RecordDialog
      open={open}
      onOpenChange={onOpenChange}
      mode={editing ? 'edit' : 'view'}
      title={editing ? '編輯採購單' : '採購單詳情'}
      description={`採購單號：${purchase.po_number}`}
      size="xl"
      history={{
        recordId: purchase.id,
        creation: { tableName: 'purchase_orders', createdBy: purchase.user_id ?? null, createdAt: purchase.created_at },
      }}
      onEdit={canEdit && !isCancelled ? startEditing : undefined}
      onCancelEdit={cancelEditing}
      onSubmit={handleSubmit}
      submitting={updatePurchaseMutation.isPending}
      error={saveError}
      editActions={
        <CancelRecordButton
          label="取消採購單"
          subject={purchase.po_number}
          description="取消後採購單不能再修改；關聯訂單若沒有其他進行中的採購單，會改回「已確認」。已有入庫紀錄的採購單無法取消。"
          pending={cancelPurchaseMutation.isPending}
          onConfirm={(reason) => cancelPurchaseMutation.mutateAsync(reason).catch(() => undefined)}
        />
      }
    >
      {isCancelled && (
        <p className="rounded-md border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
          此採購單已取消{purchase.cancel_reason ? `，原因：${purchase.cancel_reason}` : ''}，不能再修改。
        </p>
      )}

      {editing ? (
        <>
          <DetailSection title="基本資訊">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField label="狀態" htmlFor="purchase-status">
                <Select value={status} onValueChange={(value: EditableStatus) => setStatus(value)}>
                  <SelectTrigger id="purchase-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EDITABLE_STATUSES.map((value) => (
                      <SelectItem key={value} value={value}>
                        {PURCHASE_STATUS_LABELS[value]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
              <FormField label="預計到貨日期" htmlFor="purchase-expected-arrival">
                <Input
                  id="purchase-expected-arrival"
                  type="date"
                  value={expectedArrivalDate}
                  onChange={(e) => setExpectedArrivalDate(e.target.value)}
                />
              </FormField>
              <FormField label="備註" htmlFor="purchase-note" wide>
                <Textarea id="purchase-note" placeholder="輸入備註..." value={note} onChange={(e) => setNote(e.target.value)} />
              </FormField>
            </div>
          </DetailSection>

          <DetailSection title="採購產品">
            <PurchaseLineItemsEditor items={items} onChange={setItems} products={products} />
          </DetailSection>
        </>
      ) : (
        <>
          <DetailSection title="基本資訊" fields>
            <DetailField label="工廠">{purchase.factories?.name}</DetailField>
            <DetailField label="狀態">
              <Badge variant="outline">{statusLabel(PURCHASE_STATUS_LABELS, purchase.status)}</Badge>
            </DetailField>
            <DetailField label="下單日期">{formatDate(purchase.order_date)}</DetailField>
            <DetailField label="預計到貨日期">{formatDate(purchase.expected_arrival_date)}</DetailField>
            <DetailField label="最近入庫">{formatDate(lastArrivalDate(receipts))}</DetailField>
            <DetailField label="建立時間">{purchase.created_at ? new Date(purchase.created_at).toLocaleString('zh-TW') : null}</DetailField>
            <DetailField label="備註" wide>{purchase.note}</DetailField>
          </DetailSection>

          <DetailSection title="採購產品">
            <ProductLinesView lines={viewLines} quantityLabel="採購數量（公斤）" totalLabel="採購總額" showRolls />
          </DetailSection>

          {relatedOrders.length > 0 && (
            <DetailSection title="關聯訂單">
              <div className="space-y-2">
                {relatedOrders.map((order) => (
                  <div key={order.order_number} className="rounded-md border border-gray-200 p-3 text-sm">
                    <div className="font-medium text-gray-900">{order.order_number}</div>
                    {order.note && <div className="mt-1 text-gray-600">{order.note}</div>}
                  </div>
                ))}
              </div>
            </DetailSection>
          )}

          {receipts.length > 0 && (
            <DetailSection title="入庫紀錄">
              <div className="space-y-2">
                {[...receipts]
                  .sort((a, b) => (a.arrival_date ?? '').localeCompare(b.arrival_date ?? ''))
                  .map((receipt) => (
                    <div
                      key={`${receipt.receipt_number}-${receipt.arrival_date}`}
                      className="flex items-center justify-between rounded-md border border-gray-200 p-3 text-sm"
                    >
                      <span className="font-medium text-gray-900">{receipt.receipt_number ?? '-'}</span>
                      <span className="text-gray-600">{formatDate(receipt.arrival_date) ?? '-'}</span>
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
