
import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import {
  EditablePurchaseOrderItem,
  toEditablePurchaseOrderItem,
  toPurchaseOrderItemsPayload,
  usePurchaseOrderItems,
} from '@/hooks/usePurchaseOrderItems';
import { useProductOptions } from '@/hooks/useProductOptions';
import { cancelPurchaseOrder, updatePurchaseOrder, type PurchaseOrderChanges } from '@/lib/api/purchases';
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
import { PurchaseLineItemsEditor } from './PurchaseLineItemsEditor';

type EditableStatus = NonNullable<PurchaseOrderChanges['status']>;

interface EditPurchaseDialogProps {
  purchase: any;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const EditPurchaseDialog = ({ purchase, open, onOpenChange }: EditPurchaseDialogProps) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [formData, setFormData] = useState({
    expected_arrival_date: '',
    note: '',
    status: 'pending' as EditableStatus,
  });
  // Cancelled purchase orders are frozen; nobody can edit them
  const isCancelled = purchase?.status === 'cancelled';
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [items, setItems] = useState<EditablePurchaseOrderItem[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);

  const { data: itemRows } = usePurchaseOrderItems(purchase?.id, open);
  const { data: products = [] } = useProductOptions(purchase?.organization_id);

  useEffect(() => {
    if (open && itemRows) {
      setItems(itemRows.map(toEditablePurchaseOrderItem));
      setSaveError(null);
    }
  }, [open, itemRows]);

  useEffect(() => {
    if (purchase) {
      setFormData({
        expected_arrival_date: purchase.expected_arrival_date || '',
        note: purchase.note || '',
        status: (purchase.status === 'cancelled' || purchase.status === 'partial_arrived' ? 'confirmed' : purchase.status || 'pending') as EditableStatus,
      });
    }
  }, [purchase]);

  const updatePurchaseMutation = useMutation({
    mutationFn: async () => {
      // One call saves the items, dates, note and status together; the database checks the lock rules
      await updatePurchaseOrder(purchase.organization_id, purchase.id, {
        items: toPurchaseOrderItemsPayload(items),
        expected_arrival_date: formData.expected_arrival_date,
        note: formData.note,
        // The item save recalculates status; only override it when the user changed it here
        ...(formData.status !== purchase.status ? { status: formData.status } : {}),
      });
    },
    onSuccess: () => {
      toast({
        title: "成功",
        description: "採購單已更新"
      });
      queryClient.invalidateQueries({ queryKey: ['purchases'] });
      queryClient.invalidateQueries({ queryKey: ['pending-inventory'] });
      queryClient.invalidateQueries({ queryKey: ['purchase-order-items', purchase.id] });
      queryClient.invalidateQueries({ queryKey: ['record-audit-logs', purchase.id] });
      onOpenChange(false);
    },
    onError: (error: Error) => {
      console.error('Error updating purchase:', error);
      setSaveError(apiErrorMessage(error, '更新採購單失敗'));
    }
  });

  // Cancelling is refused once goods have been received against the purchase order
  const cancelPurchaseMutation = useMutation({
    mutationFn: () => cancelPurchaseOrder(purchase.organization_id, purchase.id, cancelReason),
    onSuccess: () => {
      toast({ title: '成功', description: `採購單 ${purchase.po_number} 已取消` });
      queryClient.invalidateQueries({ queryKey: ['purchases'] });
      queryClient.invalidateQueries({ queryKey: ['pending-inventory'] });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['record-audit-logs', purchase.id] });
      setCancelDialogOpen(false);
      onOpenChange(false);
    },
    onError: (error: Error) => {
      setCancelDialogOpen(false);
      setSaveError(apiErrorMessage(error, '取消採購單失敗'));
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
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

  if (!purchase) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-gray-900">編輯採購單</DialogTitle>
          <DialogDescription className="text-gray-600">
            編輯採購單 {purchase.po_number} 的資訊
          </DialogDescription>
        </DialogHeader>

        {isCancelled && (
          <p className="rounded-md border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
            此採購單已取消{purchase.cancel_reason ? `，原因：${purchase.cancel_reason}` : ''}，不能再修改。
          </p>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <fieldset disabled={isCancelled} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="status" className="text-gray-700">狀態</Label>
            <Select value={formData.status} onValueChange={(value: EditableStatus) => setFormData({...formData, status: value})}>
              <SelectTrigger className="border-gray-300 focus:border-blue-500 focus:ring-blue-500">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pending">待確認</SelectItem>
                <SelectItem value="confirmed">已下單</SelectItem>
                <SelectItem value="partial_received">部分入庫</SelectItem>
                <SelectItem value="completed">已完成</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="expected_arrival_date" className="text-gray-700">預計到貨日期</Label>
            <Input
              id="expected_arrival_date"
              type="date"
              value={formData.expected_arrival_date}
              onChange={(e) => setFormData({...formData, expected_arrival_date: e.target.value})}
              className="border-gray-300 focus:border-blue-500 focus:ring-blue-500"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="note" className="text-gray-700">備註</Label>
            <Textarea
              id="note"
              placeholder="輸入備註..."
              value={formData.note}
              onChange={(e) => setFormData({...formData, note: e.target.value})}
              className="border-gray-300 focus:border-blue-500 focus:ring-blue-500"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-gray-700">採購產品</Label>
            <PurchaseLineItemsEditor items={items} onChange={setItems} products={products} />
          </div>
          </fieldset>

          {saveError && (
            <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {saveError}
            </p>
          )}

          <div className="flex justify-end gap-3 pt-4">
            {!isCancelled && (
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="mr-auto border-red-300 text-red-700 hover:bg-red-50"
                onClick={() => setCancelDialogOpen(true)}
                disabled={cancelPurchaseMutation.isPending}
                aria-label="取消採購單"
                title="取消採購單"
              >
                <Ban className="h-4 w-4" />
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="border-gray-300 text-gray-700 hover:bg-gray-50"
            >
              {isCancelled ? '關閉' : '取消'}
            </Button>
            {!isCancelled && (
            <Button
              type="submit"
              disabled={updatePurchaseMutation.isPending}
              className="bg-blue-600 text-white hover:bg-blue-700"
            >
              {updatePurchaseMutation.isPending ? '更新中...' : '更新'}
            </Button>
            )}
          </div>
        </form>
      </DialogContent>

      <AlertDialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>取消採購單 {purchase.po_number}？</AlertDialogTitle>
            <AlertDialogDescription>
              取消後採購單不能再修改；關聯訂單若沒有其他進行中的採購單，會改回「已確認」。已有入庫紀錄的採購單無法取消。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="purchase-cancel-reason">取消原因</Label>
            <Textarea
              id="purchase-cancel-reason"
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
                cancelPurchaseMutation.mutate();
              }}
              disabled={cancelPurchaseMutation.isPending}
            >
              {cancelPurchaseMutation.isPending ? '取消中...' : '確認取消'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
};
