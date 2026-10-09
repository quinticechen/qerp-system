import React, { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useCurrentOrganization } from '@/hooks/useCurrentOrganization';
import { PRODUCT_CATALOG_QUERY_KEY, type CatalogProduct } from '@/hooks/useProductCatalog';
import { PRODUCT_CATEGORIES, setProductActive, updateProduct, type ProductChanges } from '@/lib/api/products';
import { apiErrorMessage } from '@/lib/api/client';
import { RecordDialog } from '@/components/common/RecordDialog';
import { DetailSection } from '@/components/common/DetailSection';
import { DetailField } from '@/components/common/DetailField';
import { FormField } from '@/components/common/FormField';
import { ActiveToggleButton } from '@/components/common/ActiveToggleButton';

interface ProductGroupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: CatalogProduct | null;
  // Open without the 編輯 button (members without canEditProducts)
  readOnly?: boolean;
}

// The product layer: name, category and unit shared by all its colors, and whether it can be ordered
export const ProductGroupDialog: React.FC<ProductGroupDialogProps> = ({ open, onOpenChange, product, readOnly = false }) => {
  const queryClient = useQueryClient();
  const { organizationId } = useCurrentOrganization();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('布料');
  const [unitOfMeasure, setUnitOfMeasure] = useState('KG');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setEditing(false);
  }, [open, product?.id]);

  if (!product) return null;

  const refresh = () => queryClient.invalidateQueries({ queryKey: [PRODUCT_CATALOG_QUERY_KEY] });

  const startEditing = () => {
    setName(product.name);
    setCategory(product.category);
    setUnitOfMeasure(product.unitOfMeasure);
    setEditing(true);
  };

  const handleSave = async () => {
    if (!organizationId) return;

    const changes: ProductChanges = {};
    if (name.trim() !== product.name) changes.name = name;
    if (category !== product.category) changes.category = category;
    if (unitOfMeasure.trim() !== product.unitOfMeasure) changes.unit_of_measure = unitOfMeasure;
    if (Object.keys(changes).length === 0) {
      setEditing(false);
      return;
    }

    setSaving(true);
    try {
      await updateProduct(organizationId, product.id, changes);
      toast.success('產品已更新');
      await refresh();
      setEditing(false);
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
      setEditing(false);
    } catch (error) {
      toast.error(`變更狀態失敗：${apiErrorMessage(error)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <RecordDialog
      open={open}
      onOpenChange={onOpenChange}
      mode={editing ? 'edit' : 'view'}
      title={editing ? '編輯產品' : '產品詳情'}
      description={editing ? `名稱、類別和單位會套用到此產品的 ${product.colors.length} 個顏色` : product.name}
      history={{ recordId: product.id, creation: { tableName: 'product_groups', createdBy: product.createdBy, createdAt: product.createdAt } }}
      onEdit={readOnly ? undefined : startEditing}
      onCancelEdit={() => setEditing(false)}
      onSubmit={handleSave}
      submitting={saving}
      submitDisabled={!name.trim()}
      editActions={<ActiveToggleButton isActive={product.isActive} subject="產品" onToggle={handleToggleActive} disabled={saving} />}
    >
      {editing ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="產品名稱" htmlFor="product-name" required wide>
            <Input id="product-name" value={name} onChange={(e) => setName(e.target.value)} />
          </FormField>
          <FormField label="類別" htmlFor="product-category">
            <Select value={category} onValueChange={setCategory}>
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
          </FormField>
          <FormField label="計量單位" htmlFor="product-unit">
            <Input id="product-unit" value={unitOfMeasure} onChange={(e) => setUnitOfMeasure(e.target.value)} />
          </FormField>
        </div>
      ) : (
        <DetailSection fields>
          <DetailField label="產品名稱">{product.name}</DetailField>
          <DetailField label="狀態">
            <Badge variant="outline" className={product.isActive ? 'border-green-200 bg-green-100 text-green-800' : 'border-gray-300 text-gray-600'}>
              {product.isActive ? '啟用' : '已停用'}
            </Badge>
          </DetailField>
          <DetailField label="類別">{product.category}</DetailField>
          <DetailField label="計量單位">{product.unitOfMeasure}</DetailField>
          <DetailField label="顏色數">{`${product.colors.length} 個`}</DetailField>
          <DetailField label="目前庫存">{`${product.stockQuantity.toLocaleString('zh-TW')} ${product.unitOfMeasure}`}</DetailField>
        </DetailSection>
      )}
    </RecordDialog>
  );
};
