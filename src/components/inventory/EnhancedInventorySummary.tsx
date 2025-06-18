
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useCurrentOrganization } from '@/hooks/useCurrentOrganization';
import { Card, CardContent } from '@/components/ui/card';
import { InventoryStats } from './InventoryStats';
import { InventoryTable } from './InventoryTable';

interface InventoryItem {
  product_id: string;
  product_name: string;
  color: string | null;
  color_code: string | null;
  total_stock: number;
  total_rolls: number;
  pending_in_quantity: number | null;
  pending_out_quantity: number | null;
  stock_thresholds: number | null;
}

export const EnhancedInventorySummary = () => {
  const { organizationId, hasOrganization } = useCurrentOrganization();

  const { data: inventorySummary = [], isLoading } = useQuery({
    queryKey: ['inventory-summary-enhanced', organizationId],
    queryFn: async (): Promise<InventoryItem[]> => {
      if (!organizationId) return [];

      const { data, error } = await supabase
        .from('inventory_summary_enhanced')
        .select('*')
        .eq('organization_id', organizationId);
      
      if (error) throw error;
      
      return (data || []).map((item: any) => ({
        product_id: item.product_id || '',
        product_name: item.product_name || '',
        color: item.color,
        color_code: item.color_code,
        total_stock: Number(item.total_stock || 0),
        total_rolls: Number(item.total_rolls || 0),
        pending_in_quantity: item.pending_in_quantity ? Number(item.pending_in_quantity) : null,
        pending_out_quantity: item.pending_out_quantity ? Number(item.pending_out_quantity) : null,
        stock_thresholds: item.stock_thresholds ? Number(item.stock_thresholds) : null,
      }));
    },
    enabled: hasOrganization
  });

  if (!hasOrganization) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="text-center text-gray-700">請先選擇組織</div>
        </CardContent>
      </Card>
    );
  }

  const totalProducts = inventorySummary.length;
  const totalStock = inventorySummary.reduce((sum, item) => sum + item.total_stock, 0);
  const totalRolls = inventorySummary.reduce((sum, item) => sum + item.total_rolls, 0);
  const lowStockItems = inventorySummary.filter(item => 
    item.stock_thresholds && item.total_stock < item.stock_thresholds
  ).length;

  return (
    <div className="space-y-6">
      <InventoryStats 
        totalProducts={totalProducts}
        totalStock={totalStock}
        totalRolls={totalRolls}
        lowStockItems={lowStockItems}
      />
      <InventoryTable 
        data={inventorySummary}
        loading={isLoading}
      />
    </div>
  );
};
