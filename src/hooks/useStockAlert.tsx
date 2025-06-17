
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

interface LowStockProduct {
  product_id: string;
  product_name: string;
  color: string | null;
  current_stock: number;
  threshold: number;
}

export const useStockAlert = () => {
  return useQuery({
    queryKey: ['stock-alerts'],
    queryFn: async () => {
      // 獲取所有有設定閾值的產品及其當前庫存
      const { data: stockData, error } = await supabase
        .from('stock_thresholds')
        .select(`
          product_id,
          threshold_quantity,
          products_new (
            id,
            name,
            color,
            inventory_rolls (
              current_quantity
            )
          )
        `);
      
      if (error) throw error;

      const lowStockProducts: LowStockProduct[] = [];

      stockData.forEach((item) => {
        const product = item.products_new;
        if (!product) return;

        // 計算當前總庫存
        const currentStock = (product.inventory_rolls || [])
          .reduce((sum, roll) => sum + (roll.current_quantity || 0), 0);

        // 檢查是否低於閾值
        if (currentStock < item.threshold_quantity) {
          lowStockProducts.push({
            product_id: product.id,
            product_name: product.name,
            color: product.color,
            current_stock: currentStock,
            threshold: item.threshold_quantity
          });
        }
      });

      return lowStockProducts;
    },
    refetchInterval: 60000, // 每分鐘檢查一次
  });
};
