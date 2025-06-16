import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { supabase } from '@/integrations/supabase/client';

interface InventorySummaryItem {
  product_id: string;
  product_name: string;
  color: string | null;
  color_code: string | null;
  total_stock: number;
  total_rolls: number;
  a_grade_stock: number;
  b_grade_stock: number;
  c_grade_stock: number;
  d_grade_stock: number;
  defective_stock: number;
}

interface RollDetail {
  product_id: string;
  quality: string;
  quantity: number;
  current_quantity: number;
  roll_number: string;
  products_new: {
    name: string;
    color: string | null;
    color_code: string | null;
  };
}

interface PendingData {
  product_id: string;
  color: string | null;
  pending_inventory: number;
  pending_shipping: number;
}

export const InventorySummary: React.FC = () => {
  const queryClient = useQueryClient();

  // 監聽庫存變化並自動刷新
  React.useEffect(() => {
    const channel = supabase
      .channel('inventory-changes')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'inventory_rolls'
      }, () => {
        // 當庫存卷數據變化時，刷新相關查詢
        queryClient.invalidateQueries({ queryKey: ['inventory-summary'] });
        queryClient.invalidateQueries({ queryKey: ['inventory-roll-details'] });
      })
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'inventories'
      }, () => {
        queryClient.invalidateQueries({ queryKey: ['inventory-summary'] });
        queryClient.invalidateQueries({ queryKey: ['inventory-roll-details'] });
      })
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'shipping_items'
      }, () => {
        queryClient.invalidateQueries({ queryKey: ['inventory-summary'] });
        queryClient.invalidateQueries({ queryKey: ['inventory-roll-details'] });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  const { data: inventorySummary, isLoading } = useQuery({
    queryKey: ['inventory-summary'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products_new')
        .select(`
          id,
          name,
          color,
          color_code,
          inventory_rolls (
            current_quantity,
            quality
          )
        `)
        .order('name, color');
      
      if (error) throw error;

      const processedData = data.map(product => {
        const rolls = product.inventory_rolls || [];
        const totalStock = rolls.reduce((sum, roll) => sum + (roll.current_quantity || 0), 0);
        const totalRolls = rolls.filter(roll => (roll.current_quantity || 0) > 0).length;
        
        const gradeStocks = {
          a_grade_stock: rolls.filter(r => r.quality === 'A').reduce((sum, r) => sum + (r.current_quantity || 0), 0),
          b_grade_stock: rolls.filter(r => r.quality === 'B').reduce((sum, r) => sum + (r.current_quantity || 0), 0),
          c_grade_stock: rolls.filter(r => r.quality === 'C').reduce((sum, r) => sum + (r.current_quantity || 0), 0),
          d_grade_stock: rolls.filter(r => r.quality === 'D').reduce((sum, r) => sum + (r.current_quantity || 0), 0),
          defective_stock: rolls.filter(r => r.quality === 'defective').reduce((sum, r) => sum + (r.current_quantity || 0), 0)
        };

        return {
          product_id: product.id,
          product_name: product.name,
          color: product.color,
          color_code: product.color_code,
          total_stock: totalStock,
          total_rolls: totalRolls,
          ...gradeStocks
        };
      }).filter(item => item.total_rolls > 0);

      return processedData as InventorySummaryItem[];
    },
    refetchInterval: 30000, // 每30秒自動刷新
  });

  const { data: rollDetails } = useQuery({
    queryKey: ['inventory-roll-details'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inventory_rolls')
        .select(`
          product_id,
          quality,
          quantity,
          current_quantity,
          roll_number,
          products_new!inner(name, color, color_code)
        `)
        .gt('current_quantity', 0); // 只取當前數量大於0的卷
      
      if (error) throw error;
      return data as RollDetail[];
    },
    refetchInterval: 30000,
  });

  const { data: pendingData } = useQuery({
    queryKey: ['pending-data'],
    queryFn: async () => {
      const { data: pendingInventory, error: pendingInventoryError } = await supabase
        .from('purchase_order_items')
        .select(`
          product_id,
          ordered_quantity,
          received_quantity,
          products_new!inner(color)
        `)
        .in('status', ['pending', 'partial_received']);
      
      if (pendingInventoryError) throw pendingInventoryError;

      const { data: pendingShipping, error: pendingShippingError } = await supabase
        .from('order_products')
        .select(`
          product_id,
          quantity,
          shipped_quantity,
          products_new!inner(color)
        `)
        .in('status', ['pending', 'partial_shipped']);
      
      if (pendingShippingError) throw pendingShippingError;

      const pendingMap = new Map<string, PendingData>();

      pendingInventory.forEach(item => {
        const key = `${item.product_id}_${item.products_new?.color || 'null'}`;
        const pending = (item.ordered_quantity || 0) - (item.received_quantity || 0);
        
        if (!pendingMap.has(key)) {
          pendingMap.set(key, {
            product_id: item.product_id,
            color: item.products_new?.color || null,
            pending_inventory: 0,
            pending_shipping: 0
          });
        }
        
        const existing = pendingMap.get(key)!;
        existing.pending_inventory += pending > 0 ? pending : 0;
      });

      pendingShipping.forEach(item => {
        const key = `${item.product_id}_${item.products_new?.color || 'null'}`;
        const pending = (item.quantity || 0) - (item.shipped_quantity || 0);
        
        if (!pendingMap.has(key)) {
          pendingMap.set(key, {
            product_id: item.product_id,
            color: item.products_new?.color || null,
            pending_inventory: 0,
            pending_shipping: 0
          });
        }
        
        const existing = pendingMap.get(key)!;
        existing.pending_shipping += pending > 0 ? pending : 0;
      });

      return Array.from(pendingMap.values());
    }
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-gray-900">庫存統計</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-4 text-gray-500">載入中...</div>
        </CardContent>
      </Card>
    );
  }

  const getStockBadgeColor = (stock: number) => {
    if (stock === 0) return 'bg-gray-100 text-gray-800';
    if (stock < 100) return 'bg-red-100 text-red-800';
    if (stock < 500) return 'bg-yellow-100 text-yellow-800';
    return 'bg-green-100 text-green-800';
  };

  const getRollDetailsForProduct = (productId: string, color: string | null) => {
    if (!rollDetails) return [];
    
    return rollDetails.filter(roll => 
      roll.product_id === productId && 
      roll.products_new.color === color &&
      roll.current_quantity > 0 // 確保只顯示有庫存的卷
    );
  };

  const formatRollDetails = (rolls: RollDetail[]) => {
    const qualityGroups = rolls.reduce((acc, roll) => {
      const quality = roll.quality;
      if (!acc[quality]) acc[quality] = [];
      acc[quality].push({
        rollNumber: roll.roll_number,
        quantity: roll.current_quantity, // 使用當前數量而非原始數量
      });
      return acc;
    }, {} as Record<string, Array<{rollNumber: string, quantity: number}>>);

    return Object.entries(qualityGroups).map(([quality, rollsData]) => {
      const totalWeight = rollsData.reduce((sum, r) => sum + r.quantity, 0);
      const rollsText = rollsData.map(r => `${r.rollNumber}:${r.quantity.toFixed(2)}kg`).join(', ');
      return `${quality}級: ${rollsData.length}卷\n${rollsText}\n總計=${totalWeight.toFixed(2)}kg`;
    }).join('\n\n');
  };

  const formatGradeDetails = (rolls: RollDetail[], targetGrade: string) => {
    const gradeRolls = rolls.filter(roll => roll.quality === targetGrade && roll.current_quantity > 0);
    if (gradeRolls.length === 0) return '';
    
    const rollsText = gradeRolls.map(roll => `${roll.roll_number}:${roll.current_quantity.toFixed(2)}kg`).join(', ');
    const total = gradeRolls.reduce((sum, roll) => sum + roll.current_quantity, 0);
    return `${gradeRolls.length}卷\n${rollsText}\n總計=${total.toFixed(2)}kg`;
  };

  const getPendingDataForProduct = (productId: string, color: string | null) => {
    if (!pendingData) return { pending_inventory: 0, pending_shipping: 0 };
    
    const found = pendingData.find(p => 
      p.product_id === productId && p.color === color
    );
    
    return found ? { 
      pending_inventory: found.pending_inventory, 
      pending_shipping: found.pending_shipping 
    } : { pending_inventory: 0, pending_shipping: 0 };
  };

  return (
    <TooltipProvider>
      <Card>
        <CardHeader>
          <CardTitle className="text-gray-900">庫存統計</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-gray-900">產品名稱</TableHead>
                  <TableHead className="text-gray-900">顏色</TableHead>
                  <TableHead className="text-gray-900">色碼</TableHead>
                  <TableHead className="text-gray-900">總庫存</TableHead>
                  <TableHead className="text-gray-900">總卷數</TableHead>
                  <TableHead className="text-gray-900">A級</TableHead>
                  <TableHead className="text-gray-900">B級</TableHead>
                  <TableHead className="text-gray-900">C級</TableHead>
                  <TableHead className="text-gray-900">D級</TableHead>
                  <TableHead className="text-gray-900">瑕疵品</TableHead>
                  <TableHead className="text-gray-900">待入庫</TableHead>
                  <TableHead className="text-gray-900">待出貨</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {inventorySummary?.map((item) => {
                  const rollDetailsForProduct = getRollDetailsForProduct(item.product_id, item.color);
                  const pendingInfo = getPendingDataForProduct(item.product_id, item.color);
                  
                  return (
                    <TableRow key={`${item.product_id}-${item.color || 'no-color'}`}>
                      <TableCell className="font-medium text-gray-900">
                        {item.product_name}
                      </TableCell>
                      <TableCell className="text-gray-700">
                        {item.color || '-'}
                      </TableCell>
                      <TableCell className="text-gray-700">
                        {item.color_code ? (
                          <div className="flex items-center space-x-2">
                            <div 
                              className="w-4 h-4 rounded border border-gray-400"
                              style={{ backgroundColor: item.color_code }}
                            ></div>
                            <span className="text-sm text-gray-900">{item.color_code}</span>
                          </div>
                        ) : (
                          <span className="text-gray-500">-</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge className={getStockBadgeColor(item.total_stock)}>
                          {item.total_stock.toFixed(2)} kg
                        </Badge>
                      </TableCell>
                      <TableCell className="text-gray-700">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="cursor-help hover:text-blue-600 underline decoration-dotted">
                              {item.total_rolls} 卷
                            </span>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-md">
                            <div className="whitespace-pre-line text-sm">
                              {formatRollDetails(rollDetailsForProduct)}
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      </TableCell>
                      <TableCell className="text-gray-700">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="cursor-help hover:text-blue-600 underline decoration-dotted">
                              {item.a_grade_stock.toFixed(2)} kg
                            </span>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-md">
                            <div className="whitespace-pre-line text-sm">
                              {formatGradeDetails(rollDetailsForProduct, 'A')}
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      </TableCell>
                      <TableCell className="text-gray-700">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="cursor-help hover:text-blue-600 underline decoration-dotted">
                              {item.b_grade_stock.toFixed(2)} kg
                            </span>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-md">
                            <div className="whitespace-pre-line text-sm">
                              {formatGradeDetails(rollDetailsForProduct, 'B')}
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      </TableCell>
                      <TableCell className="text-gray-700">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="cursor-help hover:text-blue-600 underline decoration-dotted">
                              {item.c_grade_stock.toFixed(2)} kg
                            </span>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-md">
                            <div className="whitespace-pre-line text-sm">
                              {formatGradeDetails(rollDetailsForProduct, 'C')}
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      </TableCell>
                      <TableCell className="text-gray-700">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="cursor-help hover:text-blue-600 underline decoration-dotted">
                              {item.d_grade_stock.toFixed(2)} kg
                            </span>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-md">
                            <div className="whitespace-pre-line text-sm">
                              {formatGradeDetails(rollDetailsForProduct, 'D')}
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      </TableCell>
                      <TableCell className="text-gray-700">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="cursor-help hover:text-blue-600 underline decoration-dotted">
                              {item.defective_stock.toFixed(2)} kg
                            </span>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-md">
                            <div className="whitespace-pre-line text-sm">
                              {formatGradeDetails(rollDetailsForProduct, 'defective')}
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      </TableCell>
                      <TableCell>
                        {pendingInfo.pending_inventory > 0 && (
                          <Badge className="bg-blue-50 text-blue-800 border-blue-200 text-xs px-1 py-0">
                            {pendingInfo.pending_inventory.toFixed(2)}kg
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {pendingInfo.pending_shipping > 0 && (
                          <Badge className="bg-orange-50 text-orange-800 border-orange-200 text-xs px-1 py-0">
                            {pendingInfo.pending_shipping.toFixed(2)}kg
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          
          {(!inventorySummary || inventorySummary.length === 0) && (
            <div className="text-center py-8 text-gray-500">
              暫無庫存資料
            </div>
          )}
        </CardContent>
      </Card>
    </TooltipProvider>
  );
};
