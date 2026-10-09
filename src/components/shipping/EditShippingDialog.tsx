
import React, { useState, useEffect, useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Ban } from 'lucide-react';
import { ShippingItemsEditor } from './ShippingItemsEditor';

interface EditShippingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shipping: any;
}

export const EditShippingDialog: React.FC<EditShippingDialogProps> = ({
  open,
  onOpenChange,
  shipping,
}) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [shippingDate, setShippingDate] = useState('');
  const [note, setNote] = useState('');
  const [items, setItems] = useState<EditableShippingItem[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Cancelled shippings are frozen; nobody can edit them
  const isCancelled = shipping?.status === 'cancelled';
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');

  const { data: itemRows } = useShippingItems(shipping?.id, open);
  const { data: shippableRolls } = useShippableRolls(shipping?.order_id, open);

  useEffect(() => {
    if (open && itemRows) {
      setItems(itemRows.map(toEditableShippingItem));
      setSaveError(null);
    }
  }, [open, itemRows]);

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

  useEffect(() => {
    if (shipping) {
      setShippingDate(shipping.shipping_date);
      setNote(shipping.note || '');
    }
  }, [shipping]);

  const updateShippingMutation = useMutation({
    mutationFn: async (updateData: {
      shipping_date: string;
      note: string;
    }) => {
      // One call saves the rolls, date and note together; the database checks the stock again
      await updateShipping(shipping.organization_id, shipping.id, { ...updateData, items: toShippingItemsPayload(items) });
    },
    onSuccess: () => {
      toast({
        title: "成功",
        description: "出貨單已成功更新",
      });
      ['shippings', 'shipping-items', 'shippable-rolls', 'orders', 'inventories', 'inventoryRolls',
        'inventory-summary', 'inventory-summary-enhanced', 'product-rolls', 'record-audit-logs']
        .forEach((key) => queryClient.invalidateQueries({ queryKey: [key] }));
      onOpenChange(false);
    },
    onError: (error: Error) => {
      console.error('Error updating shipping:', error);
      setSaveError(apiErrorMessage(error, '更新出貨單時發生錯誤'));
    },
  });

  // Cancelling puts the shipped weight back on each roll and recalculates the order
  const cancelShippingMutation = useMutation({
    mutationFn: () => cancelShipping(shipping.organization_id, shipping.id, cancelReason),
    onSuccess: () => {
      toast({ title: '成功', description: `出貨單 ${shipping.shipping_number} 已取消，庫存已歸還` });
      ['shippings', 'shipping-items', 'shippable-rolls', 'orders', 'inventories', 'inventoryRolls',
        'inventory-summary', 'inventory-summary-enhanced', 'product-rolls', 'record-audit-logs']
        .forEach((key) => queryClient.invalidateQueries({ queryKey: [key] }));
      setCancelDialogOpen(false);
      onOpenChange(false);
    },
    onError: (error: Error) => {
      setCancelDialogOpen(false);
      setSaveError(apiErrorMessage(error, '取消出貨單時發生錯誤'));
    },
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

    updateShippingMutation.mutate({
      shipping_date: shippingDate,
      note,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-gray-900">編輯出貨單</DialogTitle>
          <DialogDescription className="text-gray-700">
            出貨單號: {shipping?.shipping_number}
          </DialogDescription>
        </DialogHeader>

        {isCancelled && (
          <p className="rounded-md border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
            此出貨單已取消{shipping.cancel_reason ? `，原因：${shipping.cancel_reason}` : ''}，不能再修改。
          </p>
        )}

        <div className="space-y-4">
          <fieldset disabled={isCancelled} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="shipping_date" className="text-gray-800">出貨日期</Label>
            <Input
              id="shipping_date"
              type="date"
              value={shippingDate}
              onChange={(e) => setShippingDate(e.target.value)}
              className="border-gray-300 text-gray-900 focus:border-blue-500 focus:ring-blue-500"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="note" className="text-gray-800">備註</Label>
            <Textarea
              id="note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="輸入備註..."
              className="border-gray-300 text-gray-900 focus:border-blue-500 focus:ring-blue-500"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-gray-800">出貨布卷</Label>
            <ShippingItemsEditor items={items} onChange={setItems} rolls={rolls} capacityOf={capacityOf} />
          </div>
          </fieldset>

          {saveError && (
            <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {saveError}
            </p>
          )}
        </div>

        <DialogFooter>
          {!isCancelled && (
            <Button
              variant="outline"
              size="icon"
              className="mr-auto border-red-300 text-red-700 hover:bg-red-50"
              onClick={() => setCancelDialogOpen(true)}
              disabled={cancelShippingMutation.isPending}
              aria-label="取消出貨單"
              title="取消出貨單"
            >
              <Ban className="h-4 w-4" />
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)} className="text-gray-700 border-gray-300 hover:bg-gray-50">
            {isCancelled ? '關閉' : '取消'}
          </Button>
          {!isCancelled && (
            <Button
              onClick={handleSubmit}
              disabled={updateShippingMutation.isPending}
              className="bg-blue-600 text-white hover:bg-blue-700"
            >
              {updateShippingMutation.isPending ? '更新中...' : '更新出貨單'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>

      <AlertDialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>取消出貨單 {shipping?.shipping_number}？</AlertDialogTitle>
            <AlertDialogDescription>
              取消後出貨的重量會加回各布卷的庫存，訂單的出貨進度會重新計算，出貨單不能再修改。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="shipping-cancel-reason">取消原因</Label>
            <Textarea
              id="shipping-cancel-reason"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="選填"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>返回</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={(e) => {
                e.preventDefault();
                cancelShippingMutation.mutate();
              }}
              disabled={cancelShippingMutation.isPending}
            >
              {cancelShippingMutation.isPending ? '取消中...' : '確認取消'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
};
