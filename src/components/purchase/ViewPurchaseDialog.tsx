
import React from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

interface ViewPurchaseDialogProps {
  purchase: any;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const ViewPurchaseDialog = ({ purchase, open, onOpenChange }: ViewPurchaseDialogProps) => {
  const { data: purchaseItems } = useQuery({
    queryKey: ['purchase-items', purchase?.id],
    queryFn: async () => {
      if (!purchase?.id) return [];
      
      const { data, error } = await supabase
        .from('purchase_order_items')
        .select(`
          *,
          products_new:product_id (
            id,
            name,
            color
          )
        `)
        .eq('purchase_order_id', purchase.id);
      
      if (error) throw error;
      return data;
    },
    enabled: !!purchase?.id && open
  });

  const getStatusBadge = (status) => {
    const statusMap = {
      pending: { label: '待確認', color: 'bg-yellow-100 text-yellow-800' },
      confirmed: { label: '已下單', color: 'bg-blue-100 text-blue-800' },
      partial_arrived: { label: '部分到貨', color: 'bg-orange-100 text-orange-800' },
      completed: { label: '已完成', color: 'bg-green-100 text-green-800' },
      cancelled: { label: '已取消', color: 'bg-red-100 text-red-800' }
    };
    
    const statusInfo = statusMap[status] || { label: status, color: 'bg-gray-100 text-gray-800' };
    return (
      <Badge className={`${statusInfo.color} border-0`}>
        {statusInfo.label}
      </Badge>
    );
  };

  const calculateTotal = () => {
    if (!purchaseItems) return 0;
    return purchaseItems.reduce((total, item) => total + (item.ordered_quantity * item.unit_price), 0);
  };

  if (!purchase) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-gray-900">採購單詳情</DialogTitle>
          <DialogDescription className="text-gray-600">
            查看採購單 {purchase.po_number} 的詳細資訊
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* 基本資訊 */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-gray-700">採購單編號</label>
              <p className="text-gray-900">{purchase.po_number}</p>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">狀態</label>
              <div className="mt-1">{getStatusBadge(purchase.status)}</div>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">工廠</label>
              <p className="text-gray-900">{purchase.factories?.name}</p>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">關聯訂單</label>
              <p className="text-gray-900">{purchase.orders?.order_number || '-'}</p>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">下單日期</label>
              <p className="text-gray-900">
                {new Date(purchase.order_date).toLocaleDateString('zh-TW')}
              </p>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">預計到貨日期</label>
              <p className="text-gray-900">
                {purchase.expected_arrival_date 
                  ? new Date(purchase.expected_arrival_date).toLocaleDateString('zh-TW')
                  : '-'}
              </p>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">負責人</label>
              <p className="text-gray-900">{purchase.profiles?.full_name}</p>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">建立時間</label>
              <p className="text-gray-900">
                {new Date(purchase.created_at).toLocaleDateString('zh-TW')} {new Date(purchase.created_at).toLocaleTimeString('zh-TW')}
              </p>
            </div>
          </div>

          {purchase.note && (
            <div>
              <label className="text-sm font-medium text-gray-700">備註</label>
              <p className="text-gray-900 mt-1">{purchase.note}</p>
            </div>
          )}

          <Separator />

          {/* 採購項目 */}
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-4">採購項目</h3>
            {purchaseItems && purchaseItems.length > 0 ? (
              <div className="space-y-4">
                {purchaseItems.map((item, index) => (
                  <div key={item.id} className="border border-gray-200 rounded-lg p-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="text-sm font-medium text-gray-700">產品</label>
                        <p className="text-gray-900">
                          {item.products_new?.name} {item.products_new?.color && `- ${item.products_new.color}`}
                        </p>
                      </div>
                      <div>
                        <label className="text-sm font-medium text-gray-700">規格</label>
                        <p className="text-gray-900">
                          {item.specifications ? JSON.parse(item.specifications).specifications : '-'}
                        </p>
                      </div>
                      <div>
                        <label className="text-sm font-medium text-gray-700">數量 (公斤)</label>
                        <p className="text-gray-900">{item.ordered_quantity}</p>
                      </div>
                      <div>
                        <label className="text-sm font-medium text-gray-700">卷數</label>
                        <p className="text-gray-900">{item.ordered_rolls || '-'}</p>
                      </div>
                      <div>
                        <label className="text-sm font-medium text-gray-700">單價 (每公斤)</label>
                        <p className="text-gray-900">${item.unit_price}</p>
                      </div>
                      <div>
                        <label className="text-sm font-medium text-gray-700">小計</label>
                        <p className="text-gray-900 font-semibold">
                          ${(item.ordered_quantity * item.unit_price).toFixed(2)}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
                
                <div className="flex justify-end pt-4 border-t border-gray-200">
                  <div className="text-right">
                    <label className="text-lg font-semibold text-gray-700">總金額</label>
                    <p className="text-xl font-bold text-gray-900">${calculateTotal().toFixed(2)}</p>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-gray-500">載入中...</p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
