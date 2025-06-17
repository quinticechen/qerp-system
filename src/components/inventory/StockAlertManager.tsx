
import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, Settings, Trash2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface Product {
  id: string;
  name: string;
  color: string | null;
  color_code: string | null;
}

interface StockThreshold {
  id: string;
  product_id: string;
  threshold_quantity: number;
  created_at: string;
  products_new: Product;
}

interface StockAlertForm {
  product_id: string;
  threshold_quantity: number;
}

export const StockAlertManager: React.FC = () => {
  const [form, setForm] = useState<StockAlertForm>({
    product_id: '',
    threshold_quantity: 0
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // 獲取所有產品
  const { data: products = [] } = useQuery({
    queryKey: ['products-for-thresholds'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products_new')
        .select('id, name, color, color_code')
        .order('name, color');
      
      if (error) throw error;
      return data as Product[];
    }
  });

  // 獲取現有的庫存閾值設定
  const { data: thresholds = [], isLoading } = useQuery({
    queryKey: ['stock-thresholds'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('stock_thresholds')
        .select(`
          id,
          product_id,
          threshold_quantity,
          created_at,
          products_new (id, name, color, color_code)
        `)
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      return data as StockThreshold[];
    }
  });

  // 創建或更新庫存閾值
  const createThresholdMutation = useMutation({
    mutationFn: async (data: StockAlertForm) => {
      const { error } = await supabase
        .from('stock_thresholds')
        .insert({
          product_id: data.product_id,
          threshold_quantity: data.threshold_quantity,
          user_id: (await supabase.auth.getUser()).data.user?.id
        });
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stock-thresholds'] });
      setForm({ product_id: '', threshold_quantity: 0 });
      toast({
        title: '設定成功',
        description: '庫存閾值已設定完成'
      });
    },
    onError: (error) => {
      toast({
        title: '設定失敗',
        description: error.message,
        variant: 'destructive'
      });
    }
  });

  // 刪除庫存閾值
  const deleteThresholdMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('stock_thresholds')
        .delete()
        .eq('id', id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stock-thresholds'] });
      toast({
        title: '刪除成功',
        description: '庫存閾值已刪除'
      });
    },
    onError: (error) => {
      toast({
        title: '刪除失敗',
        description: error.message,
        variant: 'destructive'
      });
    }
  });

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};
    
    if (!form.product_id) {
      newErrors.product_id = '請選擇產品';
    }
    
    if (form.threshold_quantity <= 0) {
      newErrors.threshold_quantity = '閾值必須大於 0';
    }
    
    // 檢查是否已經設定過此產品的閾值
    const existingThreshold = thresholds.find(t => t.product_id === form.product_id);
    if (existingThreshold) {
      newErrors.product_id = '此產品已設定庫存閾值，請先刪除原設定';
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (validateForm()) {
      createThresholdMutation.mutate(form);
    }
  };

  const handleDelete = (id: string) => {
    if (confirm('確定要刪除此庫存閾值設定嗎？')) {
      deleteThresholdMutation.mutate(id);
    }
  };

  const getProductDisplayName = (product: Product) => {
    return product.color ? `${product.name} (${product.color})` : product.name;
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-gray-900">
            <Settings className="h-5 w-5" />
            庫存預警設定
          </CardTitle>
          <CardDescription>
            設定產品的庫存閾值，當庫存低於設定值時會自動發送預警通知
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="product">選擇產品</Label>
                <Select 
                  value={form.product_id} 
                  onValueChange={(value) => {
                    setForm(prev => ({ ...prev, product_id: value }));
                    setErrors(prev => ({ ...prev, product_id: '' }));
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="選擇產品" />
                  </SelectTrigger>
                  <SelectContent>
                    {products.map((product) => (
                      <SelectItem key={product.id} value={product.id}>
                        {getProductDisplayName(product)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.product_id && (
                  <p className="text-sm text-red-600">{errors.product_id}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="threshold">庫存閾值 (kg)</Label>
                <Input
                  id="threshold"
                  type="number"
                  step="0.01"
                  min="0.01"
                  placeholder="輸入庫存閾值"
                  value={form.threshold_quantity || ''}
                  onChange={(e) => {
                    setForm(prev => ({ ...prev, threshold_quantity: parseFloat(e.target.value) || 0 }));
                    setErrors(prev => ({ ...prev, threshold_quantity: '' }));
                  }}
                />
                {errors.threshold_quantity && (
                  <p className="text-sm text-red-600">{errors.threshold_quantity}</p>
                )}
              </div>

              <div className="flex items-end">
                <Button 
                  type="submit" 
                  disabled={createThresholdMutation.isPending}
                  className="w-full"
                >
                  {createThresholdMutation.isPending ? '設定中...' : '設定閾值'}
                </Button>
              </div>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-gray-900">現有庫存閾值設定</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-4 text-gray-500">載入中...</div>
          ) : thresholds.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              尚未設定任何庫存閾值
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-gray-900">產品名稱</TableHead>
                  <TableHead className="text-gray-900">顏色</TableHead>
                  <TableHead className="text-gray-900">庫存閾值</TableHead>
                  <TableHead className="text-gray-900">設定日期</TableHead>
                  <TableHead className="text-gray-900">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {thresholds.map((threshold) => (
                  <TableRow key={threshold.id}>
                    <TableCell className="font-medium text-gray-900">
                      {threshold.products_new.name}
                    </TableCell>
                    <TableCell className="text-gray-700">
                      {threshold.products_new.color || '-'}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-orange-600 border-orange-300">
                        {threshold.threshold_quantity.toFixed(2)} kg
                      </Badge>
                    </TableCell>
                    <TableCell className="text-gray-700">
                      {new Date(threshold.created_at).toLocaleDateString('zh-TW')}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(threshold.id)}
                        disabled={deleteThresholdMutation.isPending}
                        className="text-red-600 hover:text-red-700 hover:bg-red-50"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
