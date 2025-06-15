
import React from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface ViewShippingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shipping: any;
}

export const ViewShippingDialog: React.FC<ViewShippingDialogProps> = ({
  open,
  onOpenChange,
  shipping,
}) => {
  if (!shipping) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-gray-900">出貨單詳情</DialogTitle>
          <DialogDescription className="text-gray-700">
            出貨單號: {shipping.shipping_number}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* 基本資訊 */}
          <Card>
            <CardHeader>
              <CardTitle className="text-gray-900">基本資訊</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <span className="text-sm text-gray-500">客戶</span>
                  <p className="font-medium text-gray-900">{shipping.customers?.name}</p>
                </div>
                <div>
                  <span className="text-sm text-gray-500">關聯訂單</span>
                  <p className="font-medium text-gray-900">{shipping.orders?.order_number || '無'}</p>
                </div>
                <div>
                  <span className="text-sm text-gray-500">出貨日期</span>
                  <p className="font-medium text-gray-900">
                    {new Date(shipping.shipping_date).toLocaleDateString('zh-TW')}
                  </p>
                </div>
                <div>
                  <span className="text-sm text-gray-500">建立時間</span>
                  <p className="font-medium text-gray-900">
                    {new Date(shipping.created_at).toLocaleString('zh-TW')}
                  </p>
                </div>
              </div>
              
              {shipping.note && (
                <div>
                  <span className="text-sm text-gray-500">備註</span>
                  <p className="font-medium text-gray-900">{shipping.note}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* 統計資訊 */}
          <Card>
            <CardHeader>
              <CardTitle className="text-gray-900">統計資訊</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-4">
                <div className="text-center">
                  <p className="text-2xl font-bold text-blue-600">{shipping.total_shipped_quantity}</p>
                  <p className="text-sm text-gray-500">總重量 (公斤)</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold text-green-600">{shipping.total_shipped_rolls}</p>
                  <p className="text-sm text-gray-500">總卷數</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold text-purple-600">{shipping.shipping_items?.length || 0}</p>
                  <p className="text-sm text-gray-500">項目數</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* 出貨項目 */}
          <Card>
            <CardHeader>
              <CardTitle className="text-gray-900">出貨項目</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {shipping.shipping_items?.map((item: any, index: number) => (
                  <div key={item.id} className="border border-gray-200 rounded p-4">
                    <div className="flex justify-between items-start">
                      <div>
                        <h4 className="font-medium text-gray-900">
                          {item.inventory_rolls?.products_new?.name}
                          {item.inventory_rolls?.products_new?.color && 
                            ` (${item.inventory_rolls.products_new.color})`
                          }
                        </h4>
                        <p className="text-sm text-gray-600">
                          布卷編號: {item.inventory_rolls?.roll_number}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-medium text-gray-900">{item.shipped_quantity} 公斤</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </DialogContent>
    </Dialog>
  );
};
