
import React from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

interface ViewInventoryDialogProps {
  inventory: any;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const ViewInventoryDialog = ({ inventory, open, onOpenChange }: ViewInventoryDialogProps) => {
  // 獲取布卷明細
  const { data: inventoryRolls, isLoading } = useQuery({
    queryKey: ['inventoryRolls', inventory?.id],
    queryFn: async () => {
      if (!inventory?.id) return [];
      
      const { data, error } = await supabase
        .from('inventory_rolls')
        .select(`
          *,
          products_new:product_id (
            id,
            name,
            color
          ),
          warehouses:warehouse_id (
            id,
            name
          )
        `)
        .eq('inventory_id', inventory.id);
      
      if (error) throw error;
      return data;
    },
    enabled: !!inventory?.id && open
  });

  const getQualityBadge = (quality: string) => {
    const qualityMap = {
      A: { label: 'A級', color: 'bg-green-100 text-green-800' },
      B: { label: 'B級', color: 'bg-blue-100 text-blue-800' },
      C: { label: 'C級', color: 'bg-yellow-100 text-yellow-800' },
      D: { label: 'D級', color: 'bg-red-100 text-red-800' }
    };
    
    const qualityInfo = qualityMap[quality as keyof typeof qualityMap] || { label: quality, color: 'bg-gray-100 text-gray-800' };
    return (
      <Badge className={`${qualityInfo.color} border-0`}>
        {qualityInfo.label}
      </Badge>
    );
  };

  if (!inventory) return null;

  const totalQuantity = inventoryRolls?.reduce((total, roll) => total + roll.quantity, 0) || 0;
  const totalCurrentQuantity = inventoryRolls?.reduce((total, roll) => total + roll.current_quantity, 0) || 0;
  const totalRolls = inventoryRolls?.length || 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-gray-900">入庫記錄詳情</DialogTitle>
          <DialogDescription className="text-gray-600">
            查看入庫批次的詳細資訊和布卷明細
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* 基本資訊 */}
          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium text-gray-700">採購單編號</label>
                <p className="text-gray-900">{inventory.purchase_orders?.po_number}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">工廠</label>
                <p className="text-gray-900">{inventory.factories?.name}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">到貨日期</label>
                <p className="text-gray-900">
                  {new Date(inventory.arrival_date).toLocaleDateString('zh-TW')}
                </p>
              </div>
            </div>
            
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium text-gray-700">負責人</label>
                <p className="text-gray-900">{inventory.profiles?.full_name}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">建立時間</label>
                <p className="text-gray-900">
                  {new Date(inventory.created_at).toLocaleString('zh-TW')}
                </p>
              </div>
              {inventory.note && (
                <div>
                  <label className="text-sm font-medium text-gray-700">備註</label>
                  <p className="text-gray-900">{inventory.note}</p>
                </div>
              )}
            </div>
          </div>

          {/* 統計資訊 */}
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <div className="text-sm font-medium text-blue-900">總入庫數量</div>
              <div className="text-2xl font-bold text-blue-800">{totalQuantity.toFixed(2)} 公斤</div>
            </div>
            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <div className="text-sm font-medium text-green-900">當前庫存</div>
              <div className="text-2xl font-bold text-green-800">{totalCurrentQuantity.toFixed(2)} 公斤</div>
            </div>
            <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
              <div className="text-sm font-medium text-purple-900">總卷數</div>
              <div className="text-2xl font-bold text-purple-800">{totalRolls} 卷</div>
            </div>
          </div>

          {/* 布卷明細 */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-gray-900">布卷明細</h3>
            
            {isLoading ? (
              <div className="text-center py-4 text-gray-500">載入中...</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse border border-gray-200">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="border border-gray-200 px-4 py-3 text-left text-sm font-semibold text-gray-900">布卷編號</th>
                      <th className="border border-gray-200 px-4 py-3 text-left text-sm font-semibold text-gray-900">產品</th>
                      <th className="border border-gray-200 px-4 py-3 text-left text-sm font-semibold text-gray-900">倉庫</th>
                      <th className="border border-gray-200 px-4 py-3 text-left text-sm font-semibold text-gray-900">貨架</th>
                      <th className="border border-gray-200 px-4 py-3 text-center text-sm font-semibold text-gray-900">品質</th>
                      <th className="border border-gray-200 px-4 py-3 text-right text-sm font-semibold text-gray-900">入庫重量</th>
                      <th className="border border-gray-200 px-4 py-3 text-right text-sm font-semibold text-gray-900">當前重量</th>
                      <th className="border border-gray-200 px-4 py-3 text-center text-sm font-semibold text-gray-900">狀態</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inventoryRolls?.map((roll) => {
                      const specifications = roll.specifications ? 
                        (typeof roll.specifications === 'string' ? roll.specifications : 
                         JSON.stringify(roll.specifications)) : '';
                      
                      return (
                        <tr key={roll.id} className="hover:bg-gray-50">
                          <td className="border border-gray-200 px-4 py-3 text-gray-900 font-medium">
                            {roll.roll_number}
                          </td>
                          <td className="border border-gray-200 px-4 py-3 text-gray-900">
                            <div>
                              {roll.products_new?.name} {roll.products_new?.color && `- ${roll.products_new.color}`}
                            </div>
                            {specifications && (
                              <div className="text-sm text-gray-500 mt-1">{specifications}</div>
                            )}
                          </td>
                          <td className="border border-gray-200 px-4 py-3 text-gray-700">
                            {roll.warehouses?.name}
                          </td>
                          <td className="border border-gray-200 px-4 py-3 text-gray-700">
                            {roll.shelf || '-'}
                          </td>
                          <td className="border border-gray-200 px-4 py-3 text-center">
                            {getQualityBadge(roll.quality)}
                          </td>
                          <td className="border border-gray-200 px-4 py-3 text-right text-gray-900">
                            {roll.quantity.toFixed(2)}
                          </td>
                          <td className="border border-gray-200 px-4 py-3 text-right text-gray-900">
                            {roll.current_quantity.toFixed(2)}
                          </td>
                          <td className="border border-gray-200 px-4 py-3 text-center">
                            {roll.is_allocated ? (
                              <Badge className="bg-orange-100 text-orange-800 border-0">已分配</Badge>
                            ) : roll.current_quantity > 0 ? (
                              <Badge className="bg-green-100 text-green-800 border-0">可用</Badge>
                            ) : (
                              <Badge className="bg-gray-100 text-gray-800 border-0">已用完</Badge>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
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
