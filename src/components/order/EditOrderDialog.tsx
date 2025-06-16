
import React, { useState, useEffect } from 'react';
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

type OrderStatus = Database['public']['Enums']['order_status'];
type PaymentStatus = Database['public']['Enums']['payment_status'];
type ShippingStatus = Database['public']['Enums']['shipping_status'];

interface EditOrderDialogProps {
  order: any;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOrderUpdated: () => void;
}

export const EditOrderDialog: React.FC<EditOrderDialogProps> = ({
  order,
  open,
  onOpenChange,
  onOrderUpdated,
}) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [status, setStatus] = useState<OrderStatus>(order.status);
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>(order.payment_status);
  const [shippingStatus, setShippingStatus] = useState<ShippingStatus>(order.shipping_status);
  const [note, setNote] = useState(order.note || '');

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

  const updateOrderMutation = useMutation({
    mutationFn: async (updateData: {
      status: OrderStatus;
      payment_status: PaymentStatus;
      shipping_status: ShippingStatus;
      note: string;
    }) => {
      const { error } = await supabase
        .from('orders')
        .update(updateData)
        .eq('id', order.id);

      if (error) throw error;
    },
    onSuccess: () => {
      toast({
        title: "成功",
        description: "訂單已成功更新",
      });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      onOrderUpdated();
      onOpenChange(false);
    },
    onError: (error) => {
      console.error('Error updating order:', error);
      toast({
        title: "錯誤",
        description: "更新訂單時發生錯誤",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = () => {
    updateOrderMutation.mutate({
      status,
      payment_status: paymentStatus,
      shipping_status: shippingStatus,
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

  const calculateOrderTotal = () => {
    return order.order_products.reduce((total: number, product: any) => 
      total + (product.quantity * product.unit_price), 0
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-gray-900">編輯訂單</DialogTitle>
          <DialogDescription className="text-gray-700">
            訂單編號: {order.order_number}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
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
            <div className="space-y-2">
              {order.order_products.map((product: any, index: number) => (
                <div key={index} className="bg-gray-50 p-3 rounded border">
                  <div className="text-sm text-gray-900">
                    <strong>{product.products_new.name}</strong>
                    {product.products_new.color && ` (${product.products_new.color})`}
                  </div>
                  <div className="text-sm text-gray-700">
                    數量: {product.quantity}kg | 單價: ${product.unit_price} | 
                    小計: ${(product.quantity * product.unit_price).toLocaleString()}
                    {product.shipped_quantity > 0 && (
                      <span className="ml-2 text-blue-600">
                        | 已出貨: {product.shipped_quantity}kg
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
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
                  <SelectItem value="cancelled">已取消</SelectItem>
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
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button 
            onClick={handleSubmit}
            disabled={updateOrderMutation.isPending}
          >
            {updateOrderMutation.isPending ? '更新中...' : '更新訂單'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
