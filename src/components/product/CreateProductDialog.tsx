
import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useCurrentOrganization } from '@/hooks/useCurrentOrganization';

interface CreateProductDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onProductCreated: () => void;
}

export const CreateProductDialog: React.FC<CreateProductDialogProps> = ({
  open,
  onOpenChange,
  onProductCreated,
}) => {
  const [loading, setLoading] = useState(false);
  const { organizationId } = useCurrentOrganization();
  const [formData, setFormData] = useState({
    name: '',
    color: '',
    color_code: '',
    category: '布料',
    unit_of_measure: 'KG',
    stock_thresholds: '',
    status: 'Available' as 'Available' | 'Unavailable'
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!organizationId) {
      toast.error('請先選擇組織');
      return;
    }

    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast.error('請先登入');
        return;
      }

      const productData = {
        ...formData,
        organization_id: organizationId,
        user_id: user.id,
        stock_thresholds: formData.stock_thresholds ? parseFloat(formData.stock_thresholds) : null
      };

      const { error } = await supabase
        .from('products_new')
        .insert(productData);

      if (error) {
        console.error('Error creating product:', error);
        throw error;
      }

      toast.success('產品創建成功');
      setFormData({
        name: '',
        color: '',
        color_code: '',
        category: '布料',
        unit_of_measure: 'KG',
        stock_thresholds: '',
        status: 'Available'
      });
      onProductCreated();
      onOpenChange(false);
    } catch (error: any) {
      console.error('Error creating product:', error);
      toast.error('創建產品失敗');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>新增產品</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">產品名稱</Label>
            <Input
              id="name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="color">顏色</Label>
            <Input
              id="color"
              value={formData.color}
              onChange={(e) => setFormData({ ...formData, color: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="color_code">顏色代碼</Label>
            <Input
              id="color_code"
              type="color"
              value={formData.color_code}
              onChange={(e) => setFormData({ ...formData, color_code: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="category">類別</Label>
            <Select value={formData.category} onValueChange={(value) => setFormData({ ...formData, category: value })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="布料">布料</SelectItem>
                <SelectItem value="胚布">胚布</SelectItem>
                <SelectItem value="紗線">紗線</SelectItem>
                <SelectItem value="輔料">輔料</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="unit_of_measure">計量單位</Label>
            <Select value={formData.unit_of_measure} onValueChange={(value) => setFormData({ ...formData, unit_of_measure: value })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="KG">公斤 (KG)</SelectItem>
                <SelectItem value="M">公尺 (M)</SelectItem>
                <SelectItem value="PCS">件 (PCS)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="stock_thresholds">庫存警戒值</Label>
            <Input
              id="stock_thresholds"
              type="number"
              step="0.01"
              value={formData.stock_thresholds}
              onChange={(e) => setFormData({ ...formData, stock_thresholds: e.target.value })}
              placeholder="輸入庫存警戒值"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="status">狀態</Label>
            <Select value={formData.status} onValueChange={(value: 'Available' | 'Unavailable') => setFormData({ ...formData, status: value })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Available">可用</SelectItem>
                <SelectItem value="Unavailable">不可用</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex gap-2 pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} className="flex-1">
              取消
            </Button>
            <Button type="submit" disabled={loading} className="flex-1">
              {loading ? '創建中...' : '創建產品'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
