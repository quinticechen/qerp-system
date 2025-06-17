
import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Product, ProductFormData } from '@/hooks/useProducts';

interface EditProductDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: Product | null;
  onSubmit: (id: string, data: Partial<ProductFormData>) => Promise<boolean>;
}

const CATEGORIES = ['布料', '胚布', '紗線', '輔料'];

export const EditProductDialog: React.FC<EditProductDialogProps> = ({
  open,
  onOpenChange,
  product,
  onSubmit,
}) => {
  const [formData, setFormData] = useState<ProductFormData>({
    name: '',
    category: '布料',
    color: '',
    color_code: '',
    stock_thresholds: undefined,
    status: 'Available',
    unit_of_measure: 'KG',
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (product) {
      setFormData({
        name: product.name,
        category: product.category,
        color: product.color || '',
        color_code: product.color_code || '',
        stock_thresholds: product.stock_thresholds || undefined,
        status: product.status,
        unit_of_measure: product.unit_of_measure,
      });
    }
  }, [product]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!product) return;

    setLoading(true);
    const success = await onSubmit(product.id, formData);
    if (success) {
      onOpenChange(false);
    }
    setLoading(false);
  };

  const handleInputChange = (field: keyof ProductFormData, value: any) => {
    setFormData(prev => ({
      ...prev,
      [field]: value === '' ? undefined : value,
    }));
  };

  if (!product) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>編輯產品</DialogTitle>
          <DialogDescription>
            編輯產品資訊
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">產品名稱 *</Label>
            <Input
              id="name"
              value={formData.name}
              onChange={(e) => handleInputChange('name', e.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="category">類別</Label>
            <Select value={formData.category} onValueChange={(value) => handleInputChange('category', value)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((category) => (
                  <SelectItem key={category} value={category}>
                    {category}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="color">顏色</Label>
              <Input
                id="color"
                value={formData.color || ''}
                onChange={(e) => handleInputChange('color', e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="color_code">色碼</Label>
              <Input
                id="color_code"
                value={formData.color_code || ''}
                onChange={(e) => handleInputChange('color_code', e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="stock_thresholds">庫存閾值 (公斤)</Label>
            <Input
              id="stock_thresholds"
              type="number"
              min="0"
              step="0.1"
              value={formData.stock_thresholds || ''}
              onChange={(e) => handleInputChange('stock_thresholds', e.target.value ? parseFloat(e.target.value) : undefined)}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="unit_of_measure">計量單位</Label>
              <Input
                id="unit_of_measure"
                value={formData.unit_of_measure}
                onChange={(e) => handleInputChange('unit_of_measure', e.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="status">產品狀態</Label>
              <Select value={formData.status} onValueChange={(value: 'Available' | 'Unavailable') => handleInputChange('status', value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Available">可用</SelectItem>
                  <SelectItem value="Unavailable">不可用</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex justify-end space-x-2 pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? '更新中...' : '更新產品'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
