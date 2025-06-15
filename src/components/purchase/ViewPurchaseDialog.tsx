
import React from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

interface ViewPurchaseDialogProps {
  purchase: any;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const ViewPurchaseDialog = ({ purchase, open, onOpenChange }: ViewPurchaseDialogProps) => {
  // 獲取採購項目詳情
  const { data: purchaseItems, isLoading } = useQuery({
    queryKey: ['purchaseItems', purchase?.id],
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

  const getStatusBadge = (status: string) => {
    const statusMap = {
      pending: { label: '待確認', color: 'bg-yellow-100 text-yellow-800' },
      confirmed: { label: '已下單', color: 'bg-blue-100 text-blue-800' },
      partial_arrived: { label: '部分到貨', color: 'bg-orange-100 text-orange-800' },
      completed: { label: '已完成', color: 'bg-green-100 text-green-800' },
      cancelled: { label: '已取消', color: 'bg-red-100 text-red-800' }
    };
    
    const statusInfo = statusMap[status as keyof typeof statusMap] || { label: status, color: 'bg-gray-100 text-gray-800' };
    return (
      <Badge className={`${statusInfo.color} border-0`}>
        {statusInfo.label}
      </Badge>
    );
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('zh-TW', {
      style: 'currency',
      currency: 'TWD'
    }).format(amount);
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
          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium text-gray-700">採購單編號</label>
                <p className="text-gray-900">{purchase.po_number}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">工廠</label>
                <p className="text-gray-900">{purchase.factories?.name}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">關聯訂單</label>
                <p className="text-gray-900">{purchase.orders?.order_number || '無'}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">狀態</label>
                <div className="mt-1">{getStatusBadge(purchase.status)}</div>
              </div>
            </div>
            
            <div className="space-y-4">
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
                    : '未設定'}
                </p>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">負責人</label>
                <p className="text-gray-900">{purchase.profiles?.full_name}</p>
              </div>
              {purchase.note && (
                <div>
                  <label className="text-sm font-medium text-gray-700">備註</label>
                  <p className="text-gray-900">{purchase.note}</p>
                </div>
              )}
            </div>
          </div>

          {/* 採購項目 */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-gray-900">採購項目</h3>
            
            {isLoading ? (
              <div className="text-center py-4 text-gray-500">載入中...</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse border border-gray-200">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="border border-gray-200 px-4 py-3 text-left text-sm font-semibold text-gray-900">產品</th>
                      <th className="border border-gray-200 px-4 py-3 text-left text-sm font-semibold text-gray-900">規格</th>
                      <th className="border border-gray-200 px-4 py-3 text-right text-sm font-semibold text-gray-900">數量 (公斤)</th>
                      <th className="border border-gray-200 px-4 py-3 text-right text-sm font-semibold text-gray-900">卷數</th>
                      <th className="border border-gray-200 px-4 py-3 text-right text-sm font-semibold text-gray-900">單價</th>
                      <th className="border border-gray-200 px-4 py-3 text-right text-sm font-semibold text-gray-900">小計</th>
                    </tr>
                  </thead>
                  <tbody>
                    {purchaseItems?.map((item, index) => {
                      const specifications = item.specifications ? 
                        (typeof item.specifications === 'string' ? item.specifications : 
                         JSON.stringify(item.specifications)) : '';
                      
                      return (
                        <tr key={index} className="hover:bg-gray-50">
                          <td className="border border-gray-200 px-4 py-3 text-gray-900">
                            {item.products_new?.name} {item.products_new?.color && `- ${item.products_new.color}`}
                          </td>
                          <td className="border border-gray-200 px-4 py-3 text-gray-700">
                            {specifications || '-'}
                          </td>
                          <td className="border border-gray-200 px-4 py-3 text-right text-gray-900">
                            {item.ordered_quantity}
                          </td>
                          <td className="border border-gray-200 px-4 py-3 text-right text-gray-900">
                            {item.ordered_rolls || '-'}
                          </td>
                          <td className="border border-gray-200 px-4 py-3 text-right text-gray-900">
                            {formatCurrency(item.unit_price)}
                          </td>
                          <td className="border border-gray-200 px-4 py-3 text-right text-gray-900 font-semibold">
                            {formatCurrency(item.ordered_quantity * item.unit_price)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

                {/* 總計 */}
                {purchaseItems && purchaseItems.length > 0 && (
                  <div className="mt-4 flex justify-end">
                    <div className="bg-gray-50 border border-gray-200 rounded px-4 py-3">
                      <div className="flex justify-between items-center gap-8">
                        <span className="font-semibold text-gray-900">總計：</span>
                        <span className="text-lg font-bold text-gray-900">
                          {formatCurrency(
                            purchaseItems.reduce((total, item) => 
                              total + (item.ordered_quantity * item.unit_price), 0
                            )
                          )}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="flex justify-end pt-4">
            <Button
              onClick={() => onOpenChange(false)}
              className="bg-gray-600 text-white hover:bg-gray-700"
            >
              關閉
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
