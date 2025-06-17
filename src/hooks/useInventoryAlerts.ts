
import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useStockThresholds } from '@/hooks/useStockThresholds';

export type InventoryAlert = {
  product_id: string;
  product_name: string;
  color: string | null;
  current_stock: number;
  threshold_quantity: number;
  alert_level: 'warning' | 'critical';
};

export const useInventoryAlerts = () => {
  const [alerts, setAlerts] = useState<InventoryAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const { thresholds } = useStockThresholds();

  const checkInventoryAlerts = async () => {
    try {
      // 獲取庫存摘要數據
      const { data: inventoryData, error } = await supabase
        .from('inventory_summary')
        .select('*');

      if (error) throw error;

      if (!inventoryData || thresholds.length === 0) {
        setAlerts([]);
        return;
      }

      // 檢查每個有閾值的產品
      const alertList: InventoryAlert[] = [];
      
      for (const threshold of thresholds) {
        const inventory = inventoryData.find(inv => inv.product_id === threshold.product_id);
        
        if (inventory && inventory.total_stock !== null) {
          const currentStock = Number(inventory.total_stock);
          const thresholdQty = Number(threshold.threshold_quantity);
          
          if (currentStock <= thresholdQty) {
            alertList.push({
              product_id: threshold.product_id,
              product_name: inventory.product_name || '未知產品',
              color: inventory.color,
              current_stock: currentStock,
              threshold_quantity: thresholdQty,
              alert_level: currentStock <= thresholdQty * 0.5 ? 'critical' : 'warning',
            });
          }
        }
      }

      setAlerts(alertList);
    } catch (error) {
      console.error('Failed to check inventory alerts:', error);
      setAlerts([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (thresholds.length > 0) {
      checkInventoryAlerts();
    } else {
      setLoading(false);
    }
  }, [thresholds]);

  return {
    alerts,
    loading,
    checkInventoryAlerts,
  };
};
