import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import {
  EditableShippingItem,
  ShippableRoll,
  rollCapacity,
  toEditableShippingItem,
  toShippingItemsPayload,
  useShippableRolls,
  useShippingItems,
} from '@/hooks/useShippingItems';
import { cancelShipping, updateShipping } from '@/lib/api/shipping';
import { apiErrorMessage } from '@/lib/api/client';
import { SHIPPING_STATUS_LABELS, statusLabel } from '@/lib/statusLabels';
import { RecordDialog } from '@/components/common/RecordDialog';
import { DetailSection } from '@/components/common/DetailSection';
import { DetailField } from '@/components/common/DetailField';
import { FormField } from '@/components/common/FormField';
import { CancelRecordButton } from '@/components/common/CancelRecordButton';
import { ShippingItemsEditor } from './ShippingItemsEditor';

// The shipping fields the dialog shows; the list row has more
export interface ShippingRecord {
  id: string;
  organization_id: string;
  order_id: string;
  shipping_number: string;
  shipping_date: string;
  note: string | null;
  status?: string;
  cancel_reason?: string | null;
  created_at?: string;
  user_id?: string | null;
  total_shipped_quantity?: number;
  total_shipped_rolls?: number;
  customers?: { name: string } | null;
  orders?: { order_number: string } | null;
}

interface ShippingDialogProps {
  // Pass the row from the latest list data so the view shows saved changes
  shipping: ShippingRecord;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canEdit: boolean;
}

const AFFECTED_QUERIES = [
  'shippings',
  'shipping-items',
  'shippable-rolls',
  'orders',
  'inventories',
  'inventoryRolls',
  'inventory-summary',
  'inventory-summary-enhanced',
  'product-rolls',
  'record-audit-logs',
];

export const ShippingDialog: React.FC<ShippingDialogProps> = ({ shipping, open, onOpenChange, canEdit }) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  // Cancelled shippings are frozen; nobody can edit them
  const isCancelled = shipping.status === 'cancelled';
  const [editing, setEditing] = useState(false);
  const [shippingDate, setShippingDate] = useState('');
  const [note, setNote] = useState('');
  const [items, setItems] = useState<EditableShippingItem[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);

  const { data: itemRows } = useShippingItems(shipping.id, open);
  const { data: shippableRolls } = useShippableRolls(shipping.order_id, open && editing);

  useEffect(() => {
    if (open) setEditing(false);
  }, [open, shipping.id]);

  // Rolls already on this shipping stay selectable even when their remaining stock is 0
  const rolls = useMemo(() => {
    const byId = new Map<string, ShippableRoll>();
    (itemRows ?? []).forEach((row) => row.inventory_rolls && byId.set(row.inventory_roll_id, row.inventory_rolls));
    (shippableRolls ?? []).forEach((roll) => byId.set(roll.id, roll));
    return [...byId.values()];
  }, [itemRows, shippableRolls]);

  const capacityOf = (rollId: string) => {
    const roll = rolls.find((candidate) => candidate.id === rollId);
    return roll ? rollCapacity(roll, itemRows ?? []) : 0;
  };

  const startEditing = () => {
    setShippingDate(shipping.shipping_date);
    setNote(shipping.note || '');
    setItems((itemRows ?? []).map(toEditableShippingItem));
    setSaveError(null);
    setEditing(true);
  };

  const cancelEditing = () => {
    setSaveError(null);
    setEditing(false);
  };

  const refresh = () => AFFECTED_QUERIES.forEach((key) => queryClient.invalidateQueries({ queryKey: [key] }));

  const updateShippingMutation = useMutation({
    // One call saves the rolls, date and note together; the database checks the stock again
    mutationFn: () =>
      updateShipping(shipping.organization_id, shipping.id, { shipping_date: shippingDate, note, items: toShippingItemsPayload(items) }),
    onSuccess: () => {
      toast({ title: '成功', description: '出貨單已成功更新' });
      refresh();
      setEditing(false);
    },
    onError: (error: Error) => setSaveError(apiErrorMessage(error, '更新出貨單時發生錯誤')),
  });

  // Cancelling puts the shipped weight back on each roll and recalculates the order
  const cancelShippingMutation = useMutation({
    mutationFn: (reason: string) => cancelShipping(shipping.organization_id, shipping.id, reason),
    onSuccess: () => {
      toast({ title: '成功', description: `出貨單 ${shipping.shipping_number} 已取消，庫存已歸還` });
      refresh();
      setEditing(false);
    },
    onError: (error: Error) => setSaveError(apiErrorMessage(error, '取消出貨單時發生錯誤')),
  });

  const validateItems = (): string | null => {
    if (items.length === 0) return '出貨單至少需要一卷布';
    if (items.some((item) => !item.inventory_roll_id)) return '請為每一列選擇布卷';
    if (items.some((item) => !(Number(item.shipped_quantity) > 0))) return '請填寫正確的出貨重量';
    for (const item of items) {
      const capacity = capacityOf(item.inventory_roll_id);
      if (Number(item.shipped_quantity) > capacity) {
        const rollNumber = rolls.find((roll) => roll.id === item.inventory_roll_id)?.roll_number ?? '';
        return `布卷「${rollNumber}」最多可出貨 ${capacity} 公斤`;
      }
    }
    return null;
  };

  const handleSubmit = () => {
    const problem = validateItems();
    setSaveError(problem);
    if (problem) return;
    updateShippingMutation.mutate();
  };

  return (
    <RecordDialog
      open={open}
      onOpenChange={onOpenChange}
      mode={editing ? 'edit' : 'view'}
      title={editing ? '編輯出貨單' : '出貨單詳情'}
      description={`出貨單號：${shipping.shipping_number}`}
      size="lg"
      history={{
        recordId: shipping.id,
        creation: { tableName: 'shippings', createdBy: shipping.user_id ?? null, createdAt: shipping.created_at },
      }}
      onEdit={canEdit && !isCancelled ? startEditing : undefined}
      onCancelEdit={cancelEditing}
      onSubmit={handleSubmit}
      submitting={updateShippingMutation.isPending}
      error={saveError}
      editActions={
        <CancelRecordButton
          label="取消出貨單"
          subject={shipping.shipping_number}
          description="取消後出貨的重量會加回各布卷的庫存，訂單的出貨進度會重新計算，出貨單不能再修改。"
          pending={cancelShippingMutation.isPending}
          onConfirm={(reason) => cancelShippingMutation.mutateAsync(reason).catch(() => undefined)}
        />
      }
    >
      {isCancelled && (
        <p className="rounded-md border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
          此出貨單已取消{shipping.cancel_reason ? `，原因：${shipping.cancel_reason}` : ''}；出貨的重量已歸還庫存，不能再修改。
        </p>
      )}

      {editing ? (
        <>
          <DetailSection title="基本資訊">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField label="出貨日期" htmlFor="shipping-date">
                <Input id="shipping-date" type="date" value={shippingDate} onChange={(e) => setShippingDate(e.target.value)} />
              </FormField>
              <FormField label="備註" htmlFor="shipping-note" wide>
                <Textarea id="shipping-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="輸入備註..." />
              </FormField>
            </div>
          </DetailSection>

          <DetailSection title="出貨布卷">
            <ShippingItemsEditor items={items} onChange={setItems} rolls={rolls} capacityOf={capacityOf} />
          </DetailSection>
        </>
      ) : (
        <>
          <DetailSection title="基本資訊" fields>
            <DetailField label="客戶">{shipping.customers?.name}</DetailField>
            <DetailField label="關聯訂單">{shipping.orders?.order_number}</DetailField>
            <DetailField label="出貨日期">{new Date(shipping.shipping_date).toLocaleDateString('zh-TW')}</DetailField>
            <DetailField label="狀態">
              <Badge variant="outline">{statusLabel(SHIPPING_STATUS_LABELS, shipping.status)}</Badge>
            </DetailField>
            <DetailField label="總重量">{`${shipping.total_shipped_quantity} 公斤`}</DetailField>
            <DetailField label="總卷數">{`${shipping.total_shipped_rolls} 卷`}</DetailField>
            <DetailField label="建立時間">{new Date(shipping.created_at).toLocaleString('zh-TW')}</DetailField>
            <DetailField label="備註" wide>{shipping.note}</DetailField>
          </DetailSection>

          <DetailSection title="出貨布卷">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>布卷編號</TableHead>
                  <TableHead>產品</TableHead>
                  <TableHead className="text-right">出貨重量（公斤）</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(itemRows ?? []).map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium text-gray-900">{row.inventory_rolls?.roll_number}</TableCell>
                    <TableCell className="text-gray-900">
                      {row.inventory_rolls?.products_new?.name}
                      {row.inventory_rolls?.products_new?.color && ` - ${row.inventory_rolls.products_new.color}`}
                    </TableCell>
                    <TableCell className="text-right text-gray-900">{Number(row.shipped_quantity)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </DetailSection>
        </>
      )}
    </RecordDialog>
  );
};
