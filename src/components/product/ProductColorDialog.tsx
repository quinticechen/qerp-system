import React, { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { useCurrentOrganization } from '@/hooks/useCurrentOrganization';
import { PRODUCT_CATALOG_QUERY_KEY, type CatalogColor, type CatalogProduct } from '@/hooks/useProductCatalog';
import {
  addProductColor,
  setProductColorActive,
  updateProductColor,
  type ProductColorChanges,
} from '@/lib/api/products';
import { apiErrorMessage } from '@/lib/api/client';
import { NumberInput } from '@/components/common/NumberInput';
import { RecordDialog } from '@/components/common/RecordDialog';
import { DetailSection } from '@/components/common/DetailSection';
import { DetailField } from '@/components/common/DetailField';
import { FormField } from '@/components/common/FormField';
import { ActiveToggleButton } from '@/components/common/ActiveToggleButton';

interface ProductColorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: CatalogProduct | null;
  // The color to view or edit; null adds a new color to the product
  color: CatalogColor | null;
  // Open an existing color without the 編輯 button (members without canEditProducts)
  readOnly?: boolean;
}

interface ColorForm {
  color: string;
  colorCode: string;
  colorHex: string;
  stockThreshold: string;
}

const HEX_PATTERN = /^#[0-9A-Fa-f]{6}$/;

const toForm = (color: CatalogColor | null): ColorForm => ({
  color: color?.color ?? '',
  colorCode: color?.colorCode ?? '',
  colorHex: color?.colorHex ?? '',
  stockThreshold: color?.stockThreshold == null ? '' : String(color.stockThreshold),
});

// The color layer: what orders, purchases and stock refer to. A null color opens the dialog in create mode.
export const ProductColorDialog: React.FC<ProductColorDialogProps> = ({ open, onOpenChange, product, color, readOnly = false }) => {
  const queryClient = useQueryClient();
  const { organizationId } = useCurrentOrganization();
  const [form, setForm] = useState<ColorForm>(toForm(color));
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const isNew = color === null;

  // Reset when the dialog opens on a color, not when a background refetch replaces the same color
  useEffect(() => {
    if (open) {
      setForm(toForm(color));
      setEditing(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, color?.id]);

  if (!product) return null;

  const refresh = () => queryClient.invalidateQueries({ queryKey: [PRODUCT_CATALOG_QUERY_KEY] });
  const threshold = form.stockThreshold.trim() === '' ? null : Number(form.stockThreshold);
  const hexValid = form.colorHex.trim() === '' || HEX_PATTERN.test(form.colorHex.trim());

  const startEditing = () => {
    setForm(toForm(color));
    setEditing(true);
  };

  const handleSubmit = async () => {
    if (!organizationId) return;

    setSaving(true);
    try {
      if (isNew) {
        await addProductColor(organizationId, product.id, {
          color: form.color,
          color_code: form.colorCode,
          color_hex: form.colorHex,
          stock_threshold: threshold,
        });
        toast.success(`已新增顏色到「${product.name}」`);
        await refresh();
        onOpenChange(false);
        return;
      }
      const original = toForm(color);
      const changes: ProductColorChanges = {};
      if (form.color.trim() !== original.color) changes.color = form.color;
      if (form.colorCode.trim() !== original.colorCode) changes.color_code = form.colorCode;
      if (form.colorHex.trim() !== original.colorHex) changes.color_hex = form.colorHex;
      if (form.stockThreshold.trim() !== original.stockThreshold) changes.stock_threshold = threshold;
      if (Object.keys(changes).length > 0) {
        await updateProductColor(organizationId, color.id, changes);
        toast.success('顏色已更新');
        await refresh();
      }
      setEditing(false);
    } catch (error) {
      toast.error(`${isNew ? '新增' : '更新'}顏色失敗：${apiErrorMessage(error)}`);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async () => {
    if (!organizationId || !color) return;
    setSaving(true);
    try {
      await setProductColorActive(organizationId, color.id, !color.isActive);
      toast.success(color.isActive ? '顏色已停用，不能再下新訂單' : '顏色已啟用');
      await refresh();
      setEditing(false);
    } catch (error) {
      toast.error(`變更狀態失敗：${apiErrorMessage(error)}`);
    } finally {
      setSaving(false);
    }
  };

  const mode = isNew ? 'create' : editing ? 'edit' : 'view';
  const title = isNew ? '新增顏色' : editing ? '編輯顏色' : '顏色詳情';

  return (
    <RecordDialog
      open={open}
      onOpenChange={onOpenChange}
      mode={mode}
      title={title}
      description={`產品：${product.name}`}
      history={color ? { recordId: color.id, creation: { tableName: 'products_new', createdBy: color.createdBy, createdAt: color.createdAt } } : undefined}
      onEdit={readOnly ? undefined : startEditing}
      onCancelEdit={() => setEditing(false)}
      onSubmit={handleSubmit}
      submitting={saving}
      submitDisabled={!form.color.trim() || !hexValid}
      submitLabel={isNew ? '新增' : undefined}
      editActions={color && <ActiveToggleButton isActive={color.isActive} subject="顏色" onToggle={handleToggleActive} disabled={saving} />}
    >
      {mode === 'view' && color ? (
        <DetailSection fields>
          <DetailField label="顏色">{color.color}</DetailField>
          <DetailField label="色號">{color.colorCode}</DetailField>
          <DetailField label="色值">
            {color.colorHex && (
              <span className="inline-flex items-center gap-2">
                <span className="h-4 w-4 rounded border border-gray-300" style={{ backgroundColor: color.colorHex }} />
                {color.colorHex}
              </span>
            )}
          </DetailField>
          <DetailField label={`安全庫存（${product.unitOfMeasure}）`}>{color.stockThreshold}</DetailField>
          <DetailField label="狀態">
            <Badge variant="outline" className={color.isActive ? 'border-green-200 bg-green-100 text-green-800' : 'border-gray-300 text-gray-600'}>
              {color.isActive ? '啟用' : '已停用'}
            </Badge>
          </DetailField>
          <DetailField label="目前庫存">
            {`${color.stockQuantity.toLocaleString('zh-TW')} ${product.unitOfMeasure}（${color.stockRolls} 卷）`}
          </DetailField>
        </DetailSection>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="顏色" htmlFor="color-name" required>
            <Input id="color-name" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} placeholder="如：米白" />
          </FormField>
          <FormField label="色號" htmlFor="color-code">
            <Input id="color-code" value={form.colorCode} onChange={(e) => setForm({ ...form, colorCode: e.target.value })} placeholder="如：W01" />
          </FormField>
          <FormField label="色值" htmlFor="color-hex" error={hexValid ? undefined : '請使用 #RRGGBB 格式'}>
            <div className="flex items-center gap-2">
              <Input
                type="color"
                aria-label="選擇色值"
                value={HEX_PATTERN.test(form.colorHex) ? form.colorHex : '#ffffff'}
                onChange={(e) => setForm({ ...form, colorHex: e.target.value.toUpperCase() })}
                className="h-10 w-12 shrink-0 cursor-pointer p-1"
              />
              <Input
                id="color-hex"
                value={form.colorHex}
                onChange={(e) => setForm({ ...form, colorHex: e.target.value })}
                placeholder="#RRGGBB"
                aria-invalid={!hexValid}
              />
            </div>
          </FormField>
          <FormField label={`安全庫存（${product.unitOfMeasure}）`} htmlFor="color-threshold">
            <NumberInput
              id="color-threshold"
              value={form.stockThreshold}
              onValueChange={(value) => setForm({ ...form, stockThreshold: value })}
              placeholder="如：100"
            />
          </FormField>
        </div>
      )}
    </RecordDialog>
  );
};
