
import React, { useState, useEffect, useMemo } from 'react';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import type { Database } from '@/integrations/supabase/types';
import { EditableOrderItem, toEditableOrderItem, toOrderItemsPayload, useOrderItems } from '@/hooks/useOrderItems';
import { useProductOptions } from '@/hooks/useProductOptions';
import { cancelOrder, updateOrder } from '@/lib/api/orders';
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
import { OrderItemsEditor } from './OrderItemsEditor';
import { RecordAuditHistoryButton } from '@/components/common/RecordAuditHistoryButton';

type OrderStatus = Database['public']['Enums']['order_status'];
type PaymentStatus = Database['public']['Enums']['payment_status'];
type ShippingStatus = Database['public']['Enums']['shipping_status'];

interface EditOrderDialogProps {
  order: any;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOrderUpdated: () => void;
  // View the order without being able to change it (members without canEditOrders)
  readOnly?: boolean;
}

export const EditOrderDialog: React.FC<EditOrderDialogProps> = ({
  order,
  open,
  onOpenChange,
  onOrderUpdated,
  readOnly: readOnlyProp = false,
}) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  // Cancelled orders are frozen; nobody can edit them
  const isCancelled = order.status === 'cancelled';
  const readOnly = readOnlyProp || isCancelled;
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  
  const [status, setStatus] = useState<OrderStatus>(order.status);
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>(order.payment_status);
  const [shippingStatus, setShippingStatus] = useState<ShippingStatus>(order.shipping_status);
  const [note, setNote] = useState(order.note || '');
  const [items, setItems] = useState<EditableOrderItem[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);

  const { data: itemRows } = useOrderItems(order.id, open);
  const { data: products = [] } = useProductOptions(order.organization_id);

  useEffect(() => {
    if (open && itemRows) {
      setItems(itemRows.map(toEditableOrderItem));
      setSaveError(null);
    }
  }, [open, itemRows]);

  useEffect(() => {
    setStatus(order.status);
    setPaymentStatus(order.payment_status);
    setShippingStatus(order.shipping_status);
    setNote(order.note || '');
  }, [order]);

  // Fetch related purchase orders and shipping information
  const { data: relatedData } = useQuery({
    queryKey: ['order-related-data', order.id],
    queryFn: async () => {
      // Fetch purchase orders related to this order
      const { data: purchaseOrders, error: poError } = await supabase
        .from('purchase_orders')
        .select(`
          *,
          factories (name),
          purchase_order_items (
            *,
            products_new (name, color)
          )
        `)
        .eq('order_id', order.id);

      if (poError) throw poError;

      // Fetch shipping records for this order
      const { data: shippings, error: shippingError } = await supabase
        .from('shippings')
        .select(`
          *,
          shipping_items (
            *,
            inventory_rolls (
              *,
              products_new (name, color)
            )
          )
        `)
        .eq('order_id', order.id);

      if (shippingError) throw shippingError;

      return {
        purchaseOrders: purchaseOrders || [],
        shippings: shippings || []
      };
    },
    enabled: open
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

  const updateOrderMutation = useMutation({
    mutationFn: async (updateData: {
      status: Exclude<OrderStatus, 'cancelled'>;
      payment_status: PaymentStatus;
      shipping_status?: ShippingStatus;
      note: string;
    }) => {
      // One call saves the lines, statuses and note together; the database checks the lock rules
      await updateOrder(order.organization_id, order.id, { ...updateData, items: toOrderItemsPayload(items) });
    },
    onSuccess: () => {
      toast({
        title: "成功",
        description: "訂單已成功更新",
      });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['order-items', order.id] });
      queryClient.invalidateQueries({ queryKey: ['order-related-data', order.id] });
      queryClient.invalidateQueries({ queryKey: ['record-audit-logs', order.id] });
      onOrderUpdated();
      onOpenChange(false);
    },
    onError: (error: Error) => {
      console.error('Error updating order:', error);
      setSaveError(apiErrorMessage(error, '更新訂單時發生錯誤'));
    },
  });

  // Cancelling is refused once the order has shipments or live purchase orders
  const cancelOrderMutation = useMutation({
    mutationFn: () => cancelOrder(order.organization_id, order.id, cancelReason),
    onSuccess: () => {
      toast({ title: '成功', description: `訂單 ${order.order_number} 已取消` });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['record-audit-logs', order.id] });
      setCancelDialogOpen(false);
      onOrderUpdated();
      onOpenChange(false);
    },
    onError: (error: Error) => {
      setCancelDialogOpen(false);
      setSaveError(apiErrorMessage(error, '取消訂單時發生錯誤'));
    },
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
    updateOrderMutation.mutate({
      status: status as Exclude<OrderStatus, 'cancelled'>,
      payment_status: paymentStatus,
      // The item save recalculates shipping status; only override it when the user changed it here
      ...(shippingStatus !== order.shipping_status ? { shipping_status: shippingStatus } : {}),
      note,
    });
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'pending': return '待處理';
      case 'confirmed': return '已確認';
      case 'factory_ordered': return '已向工廠下單';
      case 'completed': return '已完成';
      case 'cancelled': return '已取消';
      default: return status;
    }
  };

  const getPaymentStatusText = (status: string) => {
    switch (status) {
      case 'unpaid': return '未付款';
      case 'partial_paid': return '部分付款';
      case 'paid': return '已付款';
      default: return status;
    }
  };

  const getShippingStatusText = (status: string) => {
    switch (status) {
      case 'not_started': return '未開始';
      case 'partial_shipped': return '部分出貨';
      case 'shipped': return '已出貨';
      default: return status;
    }
  };

  const getPurchaseStatusBadge = (poStatus: string) => {
    const statusMap = {
      pending: { label: '待確認', variant: 'secondary' as const },
      confirmed: { label: '已確認', variant: 'default' as const },
      partial_received: { label: '部分到貨', variant: 'outline' as const },
      completed: { label: '已完成', variant: 'default' as const },
      cancelled: { label: '已取消', variant: 'destructive' as const }
    };
    
    const config = statusMap[poStatus as keyof typeof statusMap] || { label: poStatus, variant: 'secondary' as const };
    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  const calculateOrderTotal = () =>
    items.reduce((total, item) => total + (Number(item.quantity) || 0) * (Number(item.unit_price) || 0), 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <RecordAuditHistoryButton
            recordId={order.id}
            creation={{ tableName: 'orders', createdBy: order.user_id ?? null, createdAt: order.created_at }}
            className="absolute right-10 top-2"
          />
          <DialogTitle className="text-gray-900">{readOnly ? '訂單詳情' : '編輯訂單'}</DialogTitle>
          <DialogDescription className="text-gray-700">
            訂單編號: {order.order_number}
          </DialogDescription>
        </DialogHeader>

        {isCancelled && (
          <p className="rounded-md border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
            此訂單已取消{order.cancel_reason ? `，原因：${order.cancel_reason}` : ''}，不能再修改。
          </p>
        )}

        <fieldset disabled={readOnly} className="space-y-6">
          {/* Order Information */}
          <div className="bg-gray-50 p-4 rounded-lg space-y-2">
            <div className="text-sm text-gray-700">
              <strong>客戶:</strong> {order.customers.name}
            </div>
            <div className="text-sm text-gray-700">
              <strong>訂單總額:</strong> ${calculateOrderTotal().toLocaleString()}
            </div>
            <div className="text-sm text-gray-700">
              <strong>建立時間:</strong> {new Date(order.created_at).toLocaleString('zh-TW')}
            </div>
          </div>

          {/* Purchase Status Section */}
          {relatedData?.purchaseOrders && relatedData.purchaseOrders.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-gray-900">關聯採購單狀態</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {relatedData.purchaseOrders.map((po: any) => (
                  <div key={po.id} className="flex items-center justify-between p-3 bg-gray-50 rounded">
                    <div>
                      <div className="font-medium text-gray-900">{po.po_number}</div>
                      <div className="text-sm text-gray-600">工廠: {po.factories?.name}</div>
                      <div className="text-sm text-gray-600">
                        項目數: {po.purchase_order_items?.length || 0}
                      </div>
                    </div>
                    <div className="text-right">
                      {getPurchaseStatusBadge(po.status)}
                      <div className="text-xs text-gray-500 mt-1">
                        {new Date(po.order_date).toLocaleDateString('zh-TW')}
                      </div>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Shipping Status Section */}
          {relatedData?.shippings && relatedData.shippings.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-gray-900">出貨記錄</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {relatedData.shippings.map((shipping: any) => (
                  <div key={shipping.id} className="flex items-center justify-between p-3 bg-gray-50 rounded">
                    <div>
                      <div className="font-medium text-gray-900">{shipping.shipping_number}</div>
                      <div className="text-sm text-gray-600">
                        數量: {shipping.total_shipped_quantity}kg
                      </div>
                      <div className="text-sm text-gray-600">
                        布卷數: {shipping.total_shipped_rolls}
                      </div>
                    </div>
                    <div className="text-sm text-gray-500">
                      {new Date(shipping.shipping_date).toLocaleDateString('zh-TW')}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Product Details */}
          <div className="space-y-2">
            <Label className="text-gray-800">訂單產品</Label>
            <OrderItemsEditor
              items={items}
              onChange={setItems}
              products={products}
              purchasedProductIds={purchasedProductIds}
            />
          </div>

          {/* Status Updates */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label className="text-gray-800">訂單狀態</Label>
              <Select value={status} onValueChange={(value: OrderStatus) => setStatus(value)}>
                <SelectTrigger className="border-gray-200">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending">待處理</SelectItem>
                  <SelectItem value="confirmed">已確認</SelectItem>
                  <SelectItem value="factory_ordered">已向工廠下單</SelectItem>
                  <SelectItem value="completed">已完成</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-gray-800">付款狀態</Label>
              <Select value={paymentStatus} onValueChange={(value: PaymentStatus) => setPaymentStatus(value)}>
                <SelectTrigger className="border-gray-200">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unpaid">未付款</SelectItem>
                  <SelectItem value="partial_paid">部分付款</SelectItem>
                  <SelectItem value="paid">已付款</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-gray-800">出貨狀態</Label>
              <Select value={shippingStatus} onValueChange={(value: ShippingStatus) => setShippingStatus(value)}>
                <SelectTrigger className="border-gray-200">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="not_started">未開始</SelectItem>
                  <SelectItem value="partial_shipped">部分出貨</SelectItem>
                  <SelectItem value="shipped">已出貨</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Order Note */}
          <div className="space-y-2">
            <Label htmlFor="note" className="text-gray-800">訂單備註</Label>
            <Textarea
              id="note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="輸入訂單備註..."
              className="border-gray-200 text-gray-900"
            />
          </div>
        </fieldset>

        {saveError && (
          <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {saveError}
          </p>
        )}

        <DialogFooter>
          {!readOnly && (
            <Button
              variant="outline"
              className="mr-auto border-red-300 text-red-700 hover:bg-red-50"
              onClick={() => setCancelDialogOpen(true)}
              disabled={cancelOrderMutation.isPending}
            >
              取消訂單
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {readOnly ? '關閉' : '取消'}
          </Button>
          {!readOnly && (
            <Button
              onClick={handleSubmit}
              disabled={updateOrderMutation.isPending}
            >
              {updateOrderMutation.isPending ? '更新中...' : '更新訂單'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>

      <AlertDialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>取消訂單 {order.order_number}？</AlertDialogTitle>
            <AlertDialogDescription>
              取消後訂單不能再修改。已有出貨紀錄或進行中採購單的訂單無法取消。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="cancel-reason">取消原因</Label>
            <Textarea
              id="cancel-reason"
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
                cancelOrderMutation.mutate();
              }}
              disabled={cancelOrderMutation.isPending}
            >
              {cancelOrderMutation.isPending ? '取消中...' : '確認取消'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
};
