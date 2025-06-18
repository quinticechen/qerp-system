
import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useCurrentOrganization } from '@/hooks/useCurrentOrganization';
import { Plus, Trash2 } from 'lucide-react';

interface CreateProductDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onProductCreated: () => void;
}

interface ProductVariant {
  color: string;
  color_code: string;
  stock_thresholds: string;
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
    category: '布料'
  });
  const [variants, setVariants] = useState<ProductVariant[]>([
    { color: '', color_code: '#000000', stock_thresholds: '' }
  ]);

  const addVariant = () => {
    setVariants([...variants, { color: '', color_code: '#000000', stock_thresholds: '' }]);
  };

  const removeVariant = (index: number) => {
    if (variants.length > 1) {
      setVariants(variants.filter((_, i) => i !== index));
    }
  };

  const updateVariant = (index: number, field: keyof ProductVariant, value: string) => {
    const newVariants = [...variants];
    newVariants[index][field] = value;
    setVariants(newVariants);
  };

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

      // 創建每個產品變體
      const productPromises = variants.map(variant => {
        const productData = {
          name: formData.name,
          category: formData.category,
          color: variant.color || null,
          color_code: variant.color_code || null,
          stock_thresholds: variant.stock_thresholds ? parseFloat(variant.stock_thresholds) : null,
          status: 'Available' as const,
          unit_of_measure: 'KG',
          organization_id: organizationId,
          user_id: user.id
        };

        return supabase.from('products_new').insert(productData);
      });

      const results = await Promise.all(productPromises);
      
      // 檢查是否有任何錯誤
      const errors = results.filter(result => result.error);
      if (errors.length > 0) {
        console.error('Error creating products:', errors);
        throw new Error('創建產品時發生錯誤');
      }

      toast.success(`成功創建 ${variants.length} 個產品`);
      
      // 重置表單
      setFormData({ name: '', category: '布料' });
      setVariants([{ color: '', color_code: '#000000', stock_thresholds: '' }]);
      
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
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>新增產品</DialogTitle>
          <p className="text-sm text-gray-600">可以一次新增多個產品變體（不同顏色、色碼、庫存閾值）</p>
        </DialogHeader>
        
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="name">產品名稱 *</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                required
                placeholder="輸入產品名稱"
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
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Label className="text-base font-medium">產品變體</Label>
              <Button type="button" onClick={addVariant} variant="outline" size="sm">
                <Plus className="h-4 w-4 mr-2" />
                新增變體
              </Button>
            </div>

            <div className="space-y-4">
              {variants.map((variant, index) => (
                <div key={index} className="p-4 border rounded-lg space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="font-medium">變體 {index + 1}</h4>
                    {variants.length > 1 && (
                      <Button
                        type="button"
                        onClick={() => removeVariant(index)}
                        variant="outline"
                        size="sm"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label>顏色</Label>
                      <Input
                        value={variant.color}
                        onChange={(e) => updateVariant(index, 'color', e.target.value)}
                        placeholder="輸入顏色名稱"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>色碼</Label>
                      <Input
                        type="color"
                        value={variant.color_code}
                        onChange={(e) => updateVariant(index, 'color_code', e.target.value)}
                        placeholder="如: #FF0000"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>庫存閾值 (KG)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={variant.stock_thresholds}
                        onChange={(e) => updateVariant(index, 'stock_thresholds', e.target.value)}
                        placeholder="如: 100"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="text-sm text-gray-600 space-y-1">
            <p>• 產品狀態固定為「可用」</p>
            <p>• 計量單位固定為「KG」</p>
            <p>• 每個變體將創建為獨立的產品記錄</p>
          </div>

          <div className="flex gap-2 pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} className="flex-1">
              取消
            </Button>
            <Button type="submit" disabled={loading} className="flex-1">
              {loading ? '創建中...' : `新增 ${variants.length} 個產品`}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
