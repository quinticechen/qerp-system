import React, { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
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
import { Badge } from '@/components/ui/badge';
import { Power, PowerOff } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RecordAuditHistoryButton } from '@/components/common/RecordAuditHistoryButton';
import { useCurrentOrganization } from '@/hooks/useCurrentOrganization';
import { PRODUCT_CATALOG_QUERY_KEY, type CatalogProduct } from '@/hooks/useProductCatalog';
import { PRODUCT_CATEGORIES, setProductActive, updateProduct, type ProductChanges } from '@/lib/api/products';
import { apiErrorMessage } from '@/lib/api/client';

interface ProductGroupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: CatalogProduct | null;
  // View the product without being able to change it (members without canEditProducts)
  readOnly?: boolean;
}

// The product layer: name, category and unit shared by all its colors, and whether it can be ordered
export const ProductGroupDialog: React.FC<ProductGroupDialogProps> = ({ open, onOpenChange, product, readOnly = false }) => {
  const queryClient = useQueryClient();
  const { organizationId } = useCurrentOrganization();
  const [name, setName] = useState('');
  const [category, setCategory] = useState('布料');
  const [unitOfMeasure, setUnitOfMeasure] = useState('KG');
  const [saving, setSaving] = useState(false);

  // Reset when the dialog opens on a product, not when a background refetch replaces the same product
  useEffect(() => {
    if (open && product) {
      setName(product.name);
      setCategory(product.category);
      setUnitOfMeasure(product.unitOfMeasure);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, product?.id]);

  if (!product) return null;

  const refresh = () => queryClient.invalidateQueries({ queryKey: [PRODUCT_CATALOG_QUERY_KEY] });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!organizationId) return;

    const changes: ProductChanges = {};
    if (name.trim() !== product.name) changes.name = name;
    if (category !== product.category) changes.category = category;
    if (unitOfMeasure.trim() !== product.unitOfMeasure) changes.unit_of_measure = unitOfMeasure;
    if (Object.keys(changes).length === 0) {
      onOpenChange(false);
      return;
    }

    setSaving(true);
    try {
      await updateProduct(organizationId, product.id, changes);
      toast.success('產品已更新');
      await refresh();
      onOpenChange(false);
    } catch (error) {
      toast.error(`更新產品失敗：${apiErrorMessage(error)}`);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async () => {
    if (!organizationId) return;
    setSaving(true);
    try {
      await setProductActive(organizationId, product.id, !product.isActive);
      toast.success(product.isActive ? '產品已停用，所有顏色都不能再下新訂單' : '產品已啟用');
      await refresh();
      onOpenChange(false);
    } catch (error) {
      toast.error(`變更狀態失敗：${apiErrorMessage(error)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <RecordAuditHistoryButton
            recordId={product.id}
            creation={{ tableName: 'product_groups', createdBy: product.createdBy, createdAt: product.createdAt }}
            className="absolute right-10 top-2"
          />
          <DialogTitle className="flex items-center gap-2">
            {readOnly ? '產品詳情' : '編輯產品'}
            {!product.isActive && <Badge variant="outline" className="border-gray-300 text-gray-600">已停用</Badge>}
          </DialogTitle>
          <DialogDescription>
            {readOnly ? '您的角色只能查看產品資訊' : `名稱、類別和單位會套用到此產品的 ${product.colors.length} 個顏色`}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <fieldset disabled={readOnly || saving} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="product-name">產品名稱 *</Label>
              <Input id="product-name" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="product-category">類別</Label>
                <Select value={category} onValueChange={setCategory} disabled={readOnly || saving}>
                  <SelectTrigger id="product-category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRODUCT_CATEGORIES.map((item) => (
                      <SelectItem key={item} value={item}>
                        {item}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="product-unit">計量單位</Label>
                <Input id="product-unit" value={unitOfMeasure} onChange={(e) => setUnitOfMeasure(e.target.value)} />
              </div>
            </div>
          </fieldset>

          <div className="flex items-center justify-between gap-2 pt-4">
            {!readOnly ? (
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={handleToggleActive}
                disabled={saving}
                aria-label={product.isActive ? '停用產品' : '啟用產品'}
                title={product.isActive ? '停用產品' : '啟用產品'}
              >
                {product.isActive ? <PowerOff className="h-4 w-4" /> : <Power className="h-4 w-4" />}
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {readOnly ? '關閉' : '取消'}
              </Button>
              {!readOnly && (
                <Button type="submit" disabled={saving || !name.trim()}>
                  {saving ? '儲存中...' : '儲存'}
                </Button>
              )}
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
