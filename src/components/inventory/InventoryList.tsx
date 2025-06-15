
import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search, Eye, Package } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { ViewInventoryDialog } from './ViewInventoryDialog';

export const InventoryList = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [warehouseFilter, setWarehouseFilter] = useState('all');
  const [viewingInventory, setViewingInventory] = useState(null);

  // 獲取入庫記錄
  const { data: inventories, isLoading, error } = useQuery({
    queryKey: ['inventories'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inventories')
        .select(`
          *,
          factories:factory_id (
            id,
            name
          ),
          purchase_orders:purchase_order_id (
            id,
            po_number
          ),
          profiles:user_id (
            id,
            full_name
          )
        `)
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      return data;
    }
  });

  // 獲取倉庫列表用於篩選
  const { data: warehouses } = useQuery({
    queryKey: ['warehouses'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('warehouses')
        .select('id, name')
        .order('name');
      if (error) throw error;
      return data;
    }
  });

  const filteredInventories = inventories?.filter(inventory => {
    const matchesSearch = 
      inventory.purchase_orders?.po_number?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      inventory.factories?.name?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesWarehouse = warehouseFilter === 'all' || inventory.factory_id === warehouseFilter;
    return matchesSearch && matchesWarehouse;
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="text-center text-gray-500">載入中...</div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="text-center text-red-600">載入入庫記錄時發生錯誤</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-gray-900">入庫記錄</CardTitle>
          <CardDescription className="text-gray-600">
            管理所有入庫批次記錄，查看布卷明細和庫存狀況
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-4 mb-6">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
              <Input
                placeholder="搜尋採購單編號或工廠名稱..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 border-gray-300 focus:border-blue-500 focus:ring-blue-500"
              />
            </div>
            <Select value={warehouseFilter} onValueChange={setWarehouseFilter}>
              <SelectTrigger className="w-48 border-gray-300 focus:border-blue-500 focus:ring-blue-500">
                <SelectValue placeholder="篩選倉庫" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">所有倉庫</SelectItem>
                {warehouses?.map((warehouse) => (
                  <SelectItem key={warehouse.id} value={warehouse.id}>
                    {warehouse.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-3 px-4 font-semibold text-gray-900">採購單編號</th>
                  <th className="text-left py-3 px-4 font-semibold text-gray-900">工廠</th>
                  <th className="text-left py-3 px-4 font-semibold text-gray-900">到貨日期</th>
                  <th className="text-left py-3 px-4 font-semibold text-gray-900">負責人</th>
                  <th className="text-left py-3 px-4 font-semibold text-gray-900">建立時間</th>
                  <th className="text-left py-3 px-4 font-semibold text-gray-900">操作</th>
                </tr>
              </thead>
              <tbody>
                {filteredInventories?.map((inventory) => (
                  <tr key={inventory.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-3 px-4 text-gray-900">{inventory.purchase_orders?.po_number}</td>
                    <td className="py-3 px-4 text-gray-700">{inventory.factories?.name}</td>
                    <td className="py-3 px-4 text-gray-700">
                      {new Date(inventory.arrival_date).toLocaleDateString('zh-TW')}
                    </td>
                    <td className="py-3 px-4 text-gray-700">{inventory.profiles?.full_name}</td>
                    <td className="py-3 px-4 text-gray-700">
                      {new Date(inventory.created_at).toLocaleDateString('zh-TW')}
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setViewingInventory(inventory)}
                          className="text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {filteredInventories?.length === 0 && (
            <div className="text-center py-8 text-gray-500">
              <Package className="mx-auto h-12 w-12 text-gray-300 mb-4" />
              <p>沒有找到符合條件的入庫記錄</p>
            </div>
          )}
        </CardContent>
      </Card>

      {viewingInventory && (
        <ViewInventoryDialog
          inventory={viewingInventory}
          open={!!viewingInventory}
          onOpenChange={(open) => !open && setViewingInventory(null)}
        />
      )}
    </>
  );
};
