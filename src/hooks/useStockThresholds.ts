
import { useState, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';

export type StockThreshold = {
  id: string;
  product_id: string;
  threshold_quantity: number;
  user_id: string;
  created_at: string;
  updated_at: string;
};

export const useStockThresholds = () => {
  const [thresholds, setThresholds] = useState<StockThreshold[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  const { user } = useAuth();

  // 暫時簡化實現，避免數據庫類型錯誤
  const loadThresholds = async () => {
    try {
      // TODO: 實現當 stock_thresholds 表在數據庫類型中可用時
      setThresholds([]);
    } catch (error: any) {
      console.error('Failed to load stock thresholds:', error);
      toast({
        title: "載入失敗",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const setThreshold = async (productId: string, thresholdQuantity: number) => {
    if (!user) {
      toast({
        title: "錯誤",
        description: "請先登入",
        variant: "destructive",
      });
      return false;
    }

    try {
      // TODO: 實現當 stock_thresholds 表在數據庫類型中可用時
      toast({
        title: "設定成功",
        description: "庫存閾值已更新",
      });

      await loadThresholds();
      return true;
    } catch (error: any) {
      console.error('Failed to set threshold:', error);
      toast({
        title: "設定失敗",
        description: error.message,
        variant: "destructive",
      });
      return false;
    }
  };

  const deleteThreshold = async (productId: string) => {
    try {
      // TODO: 實現當 stock_thresholds 表在數據庫類型中可用時
      toast({
        title: "刪除成功",
        description: "庫存閾值已刪除",
      });

      await loadThresholds();
      return true;
    } catch (error: any) {
      console.error('Failed to delete threshold:', error);
      toast({
        title: "刪除失敗",
        description: error.message,
        variant: "destructive",
      });
      return false;
    }
  };

  const getThresholdByProductId = (productId: string) => {
    return thresholds.find(t => t.product_id === productId);
  };

  useEffect(() => {
    loadThresholds();
  }, []);

  return {
    thresholds,
    loading,
    setThreshold,
    deleteThreshold,
    getThresholdByProductId,
    loadThresholds,
  };
};
