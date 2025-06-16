
import React from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface ViewPurchaseDialogProps {
  purchase: any;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const ViewPurchaseDialog = ({ purchase, open, onOpenChange }: ViewPurchaseDialogProps) => {
  if (!purchase) return null;

  const getStatusBadge = (status: string) => {
    const statusMap = {
      pending: { label: '待確認', variant: 'secondary' as const },
      confirmed: { label: '已下單', variant: 'default' as const },
      partial_arrived: { label: '部分到貨', variant: 'outline' as const },
      completed: { label: '已完成', variant: 'default' as const },
      cancelled: { label: '已取消', variant: 'destructive' as const }
    };
    
    const config = statusMap[status as keyof typeof statusMap] || { label: status, variant: 'secondary' as const };
    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  const totalAmount = purchase.purchase_order_items?.reduce(
    (sum: number, item: any) => sum + (item.ordered_quantity * item.unit_price), 
    0
  ) || 0;

  const totalQuantity = purchase.purchase_order_items?.reduce(
    (sum: number, item: any) => sum + item.ordered_quantity, 
    0
  ) || 0;

  // 獲取關聯訂單
  const relatedOrders = purchase.purchase_order_relations?.map((rel: any) => rel.orders) || [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-gray-900">採購單詳情 - {purchase.po_number}</DialogTitle>
          <DialogDescription className="text-gray-600">
            查看採購單的詳細資訊
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* 基本資訊 */}
          <Card>
            <CardHeader>
              <CardTitle className="text-gray-800">基本資訊</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-gray-500">採購單號</p>
                <p className="font-medium text-gray-900">{purchase.po_number}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">工廠</p>
                <p className="font-medium text-gray-900">{purchase.factories?.name}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">狀態</p>
                {getStatusBadge(purchase.status)}
              </div>
              <div>
                <p className="text-sm text-gray-500">下單日期</p>
                <p className="font-medium text-gray-900">
                  {new Date(purchase.order_date).toLocaleDateString('zh-TW')}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-500">預計到貨日期</p>
                <p className="font-medium text-gray-900">
                  {purchase.expected_arrival_date 
                    ? new Date(purchase.expected_arrival_date).toLocaleDateString('zh-TW')
                    : '未設定'
                  }
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-500">總金額</p>
                <p className="font-medium text-gray-900">${totalAmount.toFixed(2)}</p>
              </div>
            </CardContent>
          </Card>

          {/* 關聯訂單 */}
          {relatedOrders.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-gray-800">關聯訂單</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid gap-2">
                  {relatedOrders.map((order: any, index: number) => (
                    <div key={index} className="flex items-center justify-between p-3 border rounded-lg">
                      <div>
                        <p className="font-medium text-gray-900">{order.order_number}</p>
                        {order.note && (
                          <p className="text-sm text-gray-600 mt-1">{order.note}</p>
                        )}
                      </div>
                      <Badge variant="outline">關聯</Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* 產品明細 */}
          <Card>
            <CardHeader>
              <CardTitle className="text-gray-800">產品明細</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {purchase.purchase_order_items?.map((item: any, index: number) => (
                  <div key={index} className="flex items-center justify-between p-3 border rounded-lg">
                    <div className="flex-1">
                      <p className="font-medium text-gray-900">
                        {item.products_new?.name}
                        {item.products_new?.color && (
                          <span className="text-gray-600"> - {item.products_new.color}</span>
                        )}
                      </p>
                      {item.specifications && (
                        <p className="text-sm text-gray-600 mt-1">
                          規格: {JSON.stringify(item.specifications)}
                        </p>
                      )}
                    </div>
                    <div className="text-right">
                      <p className="font-medium text-gray-900">
                        {item.ordered_quantity} kg × ${item.unit_price}
                      </p>
                      <p className="text-sm text-gray-600">
                        小計: ${(item.ordered_quantity * item.unit_price).toFixed(2)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
              
              <div className="mt-4 pt-4 border-t">
                <div className="flex justify-between text-lg font-semibold text-gray-900">
                  <span>總計:</span>
                  <span>{totalQuantity.toFixed(2)} kg - ${totalAmount.toFixed(2)}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* 備註 */}
          {purchase.note && (
            <Card>
              <CardHeader>
                <CardTitle className="text-gray-800">備註</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-gray-700 whitespace-pre-wrap">{purchase.note}</p>
              </CardContent>
            </Card>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
