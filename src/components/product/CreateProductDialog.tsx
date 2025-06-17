
import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface CreateProductDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface ProductForm {
  name: string;
  category: string;
  color: string;
  color_code: string;
  unit_of_measure: string;
  stock_threshold?: number;
}

export const CreateProductDialog: React.FC<CreateProductDialogProps> = ({
  open,
  onOpenChange
}) => {
  const [form, setForm] = useState<ProductForm>({
    name: '',
    category: '布料',
    color: '',
    color_code: '',
    unit_of_measure: 'KG',
    stock_threshold: undefined
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const createProductMutation = useMutation({
    mutationFn: async (data: ProductForm) => {
      const user = await supabase.auth.getUser();
      if (!user.data.user) throw new Error('用戶未登入');

      // 創建產品
      const { data: product, error: productError } = await supabase
        .from('products_new')
        .insert({
          name: data.name,
          category: data.category,
          color: data.color,
          color_code: data.color_code,
          unit_of_measure: data.unit_of_measure,
          user_id: user.data.user.id
        })
        .select()
        .single();

      if (productError) throw productError;

      // 如果設定了庫存閾值，創建閾值記錄
      if (data.stock_threshold && data.stock_threshold > 0) {
        const { error: thresholdError } = await supabase
          .from('stock_thresholds')
          .insert({
            product_id: product.id,
            threshold_quantity: data.stock_threshold,
            user_id: user.data.user.id
          });

        if (thresholdError) throw thresholdError;
      }

      return product;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products-for-thresholds'] });
      queryClient.invalidateQueries({ queryKey: ['stock-thresholds'] });
      queryClient.invalidateQueries({ queryKey: ['stock-alerts'] });
      setForm({
        name: '',
        category: '布料',
        color: '',
        color_code: '',
        unit_of_measure: 'KG',
        stock_threshold: undefined
      });
      setErrors({});
      onOpenChange(false);
      toast({
        title: '新增成功',
        description: '產品已成功新增'
      });
    },
    onError: (error) => {
      toast({
        title: '新增失敗',
        description: error.message,
        variant: 'destructive'
      });
    }
  });

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};
    
    if (!form.name.trim()) {
      newErrors.name = '產品名稱為必填';
    }
    
    if (form.stock_threshold !== undefined && form.stock_threshold <= 0) {
      newErrors.stock_threshold = '庫存閾值必須大於 0';
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (validateForm()) {
      createProductMutation.mutate(form);
    }
  };

  const handleInputChange = (field: keyof ProductForm, value: string | number) => {
    setForm(prev => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: '' }));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-gray-900">新增產品</DialogTitle>
          <DialogDescription>
            填寫產品資訊以新增至系統中
          </DialogDescription>
        </DialogHeader>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">產品名稱 *</Label>
            <Input
              id="name"
              placeholder="輸入產品名稱"
              value={form.name}
              onChange={(e) => handleInputChange('name', e.target.value)}
            />
            {errors.name && (
              <p className="text-sm text-red-600">{errors.name}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="category">產品類別</Label>
            <Select value={form.category} onValueChange={(value) => handleInputChange('category', value)}>
              <SelectTrigger>
                <SelectValue placeholder="選擇產品類別" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="布料">布料</SelectItem>
                <SelectItem value="成品">成品</SelectItem>
                <SelectItem value="配件">配件</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="color">顏色</Label>
              <Input
                id="color"
                placeholder="輸入顏色"
                value={form.color}
                onChange={(e) => handleInputChange('color', e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="color_code">色號</Label>
              <Input
                id="color_code"
                placeholder="輸入色號"
                value={form.color_code}
                onChange={(e) => handleInputChange('color_code', e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="unit_of_measure">計量單位</Label>
            <Select value={form.unit_of_measure} onValueChange={(value) => handleInputChange('unit_of_measure', value)}>
              <SelectTrigger>
                <SelectValue placeholder="選擇計量單位" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="KG">公斤 (KG)</SelectItem>
                <SelectItem value="M">公尺 (M)</SelectItem>
                <SelectItem value="PCS">件 (PCS)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="stock_threshold">庫存閾值 (可選)</Label>
            <Input
              id="stock_threshold"
              type="number"
              step="0.01"
              min="0.01"
              placeholder="輸入庫存閾值 (kg)"
              value={form.stock_threshold || ''}
              onChange={(e) => {
                const value = e.target.value;
                handleInputChange('stock_threshold', value ? parseFloat(value) : undefined);
              }}
            />
            <p className="text-xs text-gray-500">
              設定後，當庫存低於此值時會自動發送預警通知
            </p>
            {errors.stock_threshold && (
              <p className="text-sm text-red-600">{errors.stock_threshold}</p>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button 
              type="button" 
              variant="outline" 
              onClick={() => onOpenChange(false)}
            >
              取消
            </Button>
            <Button 
              type="submit" 
              disabled={createProductMutation.isPending}
            >
              {createProductMutation.isPending ? '新增中...' : '新增產品'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
