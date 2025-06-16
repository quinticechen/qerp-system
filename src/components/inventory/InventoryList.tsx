
import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SearchInput } from '@/components/ui/search-input';
import { Eye, Package, Filter } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { ViewInventoryDialog } from './ViewInventoryDialog';
import { useDebounce } from '@/hooks/useDebounce';

export const InventoryList = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedInventory, setSelectedInventory] = useState<any | null>(null);
  const [viewDialogOpen, setViewDialogOpen] = useState(false);

  // 使用防抖處理搜尋輸入
  const debouncedSearchTerm = useDebounce(searchTerm, 500);

  const { data: inventories, isLoading } = useQuery({
    queryKey: ['inventories', debouncedSearchTerm],
    queryFn: async () => {
      let query = supabase
        .from('inventories')
        .select(`
          *,
          factories (name),
          purchase_orders (po_number),
          inventory_rolls (
            id,
            quantity,
            current_quantity,
            roll_number,
            quality,
            shelf,
            products_new (name, color),
            warehouses (name)
          )
        `)
        .order('created_at', { ascending: false });

      const { data, error } = await query;
      if (error) throw error;

      // 客戶端篩選
      let filteredData = data;

      if (debouncedSearchTerm) {
        filteredData = data.filter((inventory: any) =>
          inventory.purchase_orders?.po_number?.toLowerCase().includes(debouncedSearchTerm.toLowerCase()) ||
          inventory.factories?.name?.toLowerCase().includes(debouncedSearchTerm.toLowerCase()) ||
          inventory.inventory_rolls?.some((roll: any) =>
            roll.products_new?.name?.toLowerCase().includes(debouncedSearchTerm.toLowerCase()) ||
            roll.roll_number?.toLowerCase().includes(debouncedSearchTerm.toLowerCase())
          )
        );
      }

      return filteredData;
    }
  });

  const getQualityBadge = (quality: string) => {
    const qualityMap = {
      A: { label: 'A級', variant: 'default' as const },
      B: { label: 'B級', variant: 'secondary' as const },
      C: { label: 'C級', variant: 'outline' as const },
      D: { label: 'D級', variant: 'outline' as const },
      defective: { label: '次品', variant: 'destructive' as const }
    };
    
    const config = qualityMap[quality as keyof typeof qualityMap] || { label: quality, variant: 'secondary' as const };
    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  const handleView = (inventory: any) => {
    setSelectedInventory(inventory);
    setViewDialogOpen(true);
  };

  if (isLoading) {
    return <div className="text-center py-8 text-gray-500">載入中...</div>;
  }

  return (
    <div className="space-y-6">
      {/* 搜尋篩選 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-gray-900">
            <Filter className="h-5 w-5" />
            篩選條件
          </CardTitle>
        </CardHeader>
        <CardContent>
          <SearchInput
            placeholder="搜尋採購單號、工廠、產品或布卷編號..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full"
          />
        </CardContent>
      </Card>

      {/* 入庫記錄列表 */}
      <div className="grid gap-4">
        {inventories?.map((inventory) => {
          const totalQuantity = inventory.inventory_rolls?.reduce(
            (sum: number, roll: any) => sum + parseFloat(roll.current_quantity || 0), 
            0
          ) || 0;
          
          const totalRolls = inventory.inventory_rolls?.length || 0;

          return (
            <Card key={inventory.id} className="hover:shadow-md transition-shadow">
              <CardContent className="p-6">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">
                      採購單：{inventory.purchase_orders?.po_number}
                    </h3>
                    <p className="text-gray-600">工廠：{inventory.factories?.name}</p>
                    <p className="text-gray-600">
                      到貨日期：{new Date(inventory.arrival_date).toLocaleDateString('zh-TW')}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-gray-500">
                      建立時間：{new Date(inventory.created_at).toLocaleDateString('zh-TW')}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                  <div>
                    <p className="text-sm text-gray-500">總重量</p>
                    <p className="font-medium text-gray-900">{totalQuantity.toFixed(2)} 公斤</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">總卷數</p>
                    <p className="font-medium text-gray-900">{totalRolls} 卷</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">產品種類</p>
                    <p className="font-medium text-gray-900">
                      {new Set(inventory.inventory_rolls?.map((roll: any) => roll.products_new?.name)).size} 種
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">倉庫分布</p>
                    <p className="font-medium text-gray-900">
                      {new Set(inventory.inventory_rolls?.map((roll: any) => roll.warehouses?.name)).size} 個倉庫
                    </p>
                  </div>
                </div>

                {/* 顯示前幾個布卷概要 */}
                <div className="space-y-2 mb-4">
                  <p className="text-sm font-medium text-gray-700">布卷概要：</p>
                  <div className="flex flex-wrap gap-2">
                    {inventory.inventory_rolls?.slice(0, 3).map((roll: any, index: number) => (
                      <div key={index} className="flex items-center gap-2 text-sm">
                        <span className="text-gray-600">
                          {roll.products_new?.name} {roll.products_new?.color && `- ${roll.products_new.color}`}
                        </span>
                        {getQualityBadge(roll.quality)}
                        <span className="text-gray-500">
                          {parseFloat(roll.current_quantity).toFixed(2)}kg
                        </span>
                      </div>
                    ))}
                    {inventory.inventory_rolls?.length > 3 && (
                      <span className="text-gray-500 text-sm">
                        等 {inventory.inventory_rolls.length - 3} 個...
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleView(inventory)}
                    className="border-gray-300 text-gray-700 hover:bg-gray-50"
                  >
                    <Eye className="h-4 w-4 mr-1" />
                    查看詳細
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}

        {inventories?.length === 0 && (
          <Card>
            <CardContent className="text-center py-8">
              <Package className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-500">沒有找到入庫記錄</p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* 查看對話框 */}
      {selectedInventory && (
        <ViewInventoryDialog
          open={viewDialogOpen}
          onOpenChange={setViewDialogOpen}
          inventory={selectedInventory}
        />
      )}
    </div>
  );
};
