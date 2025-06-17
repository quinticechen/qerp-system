
import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
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

  // 載入所有閾值
  const loadThresholds = async () => {
    try {
      const { data, error } = await supabase
        .from('stock_thresholds')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setThresholds(data || []);
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

  // 設定或更新產品閾值
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
      const { error } = await supabase
        .from('stock_thresholds')
        .upsert({
          product_id: productId,
          threshold_quantity: thresholdQuantity,
          user_id: user.id,
        });

      if (error) throw error;

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

  // 刪除產品閾值
  const deleteThreshold = async (productId: string) => {
    try {
      const { error } = await supabase
        .from('stock_thresholds')
        .delete()
        .eq('product_id', productId);

      if (error) throw error;

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

  // 獲取特定產品的閾值
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
