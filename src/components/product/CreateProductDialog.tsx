
import React, { useState } from 'react';
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Trash2, Plus } from 'lucide-react';
import { ProductFormData } from '@/hooks/useProducts';

interface CreateProductDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: ProductFormData) => Promise<boolean>;
}

interface ProductVariant {
  id: string;
  color: string;
  color_code: string;
  stock_thresholds: number | undefined;
}

const CATEGORIES = ['布料', '胚布', '紗線', '輔料'];

export const CreateProductDialog: React.FC<CreateProductDialogProps> = ({
  open,
  onOpenChange,
  onSubmit,
}) => {
  const [productName, setProductName] = useState('');
  const [category, setCategory] = useState('布料');
  const [variants, setVariants] = useState<ProductVariant[]>([
    { id: '1', color: '', color_code: '', stock_thresholds: undefined }
  ]);
  const [loading, setLoading] = useState(false);

  const addVariant = () => {
    const newVariant: ProductVariant = {
      id: Date.now().toString(),
      color: '',
      color_code: '',
      stock_thresholds: undefined
    };
    setVariants([...variants, newVariant]);
  };

  const removeVariant = (id: string) => {
    if (variants.length > 1) {
      setVariants(variants.filter(v => v.id !== id));
    }
  };

  const updateVariant = (id: string, field: keyof Omit<ProductVariant, 'id'>, value: any) => {
    setVariants(variants.map(variant => 
      variant.id === id 
        ? { ...variant, [field]: value === '' ? undefined : value }
        : variant
    ));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      // 為每個變體創建產品
      for (const variant of variants) {
        const productData: ProductFormData = {
          name: productName,
          category: category,
          color: variant.color || undefined,
          color_code: variant.color_code || undefined,
          stock_thresholds: variant.stock_thresholds,
          status: 'Available', // 固定為可用
          unit_of_measure: 'KG', // 固定為KG
        };

        const success = await onSubmit(productData);
        if (!success) {
          setLoading(false);
          return;
        }
      }

      // 重置表單
      setProductName('');
      setCategory('布料');
      setVariants([{ id: '1', color: '', color_code: '', stock_thresholds: undefined }]);
      onOpenChange(false);
    } catch (error) {
      console.error('Failed to create products:', error);
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setProductName('');
    setCategory('布料');
    setVariants([{ id: '1', color: '', color_code: '', stock_thresholds: undefined }]);
  };

  return (
    <Dialog open={open} onOpenChange={(open) => {
      if (!open) resetForm();
      onOpenChange(open);
    }}>
      <DialogContent className="sm:max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>新增產品</DialogTitle>
          <DialogDescription>
            可以一次新增多個產品變體（不同顏色、色碼、庫存閾值）
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* 基本產品資訊 */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="name">產品名稱 *</Label>
              <Input
                id="name"
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="category">類別</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((cat) => (
                    <SelectItem key={cat} value={cat}>
                      {cat}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* 產品變體表格 */}
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <Label>產品變體</Label>
              <Button type="button" onClick={addVariant} size="sm" variant="outline">
                <Plus className="h-4 w-4 mr-2" />
                新增變體
              </Button>
            </div>

            <div className="border rounded-lg">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>顏色</TableHead>
                    <TableHead>色碼</TableHead>
                    <TableHead>庫存閾值 (KG)</TableHead>
                    <TableHead className="w-16">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {variants.map((variant) => (
                    <TableRow key={variant.id}>
                      <TableCell>
                        <Input
                          value={variant.color}
                          onChange={(e) => updateVariant(variant.id, 'color', e.target.value)}
                          placeholder="輸入顏色名稱"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          value={variant.color_code}
                          onChange={(e) => updateVariant(variant.id, 'color_code', e.target.value)}
                          placeholder="如: #FF0000"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min="0"
                          step="0.1"
                          value={variant.stock_thresholds || ''}
                          onChange={(e) => updateVariant(variant.id, 'stock_thresholds', e.target.value ? parseFloat(e.target.value) : undefined)}
                          placeholder="如: 100"
                        />
                      </TableCell>
                      <TableCell>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => removeVariant(variant.id)}
                          disabled={variants.length === 1}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="text-sm text-gray-600">
              <p>• 產品狀態固定為「可用」</p>
              <p>• 計量單位固定為「KG」</p>
              <p>• 每個變體將創建為獨立的產品記錄</p>
            </div>
          </div>

          <div className="flex justify-end space-x-2 pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" disabled={loading || !productName.trim()}>
              {loading ? '新增中...' : `新增 ${variants.length} 個產品`}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
