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
import { RecordAuditHistoryButton } from '@/components/common/RecordAuditHistoryButton';
import { useCurrentOrganization } from '@/hooks/useCurrentOrganization';
import { PRODUCT_CATALOG_QUERY_KEY, type CatalogColor, type CatalogProduct } from '@/hooks/useProductCatalog';
import {
  addProductColor,
  setProductColorActive,
  updateProductColor,
  type ProductColorChanges,
} from '@/lib/api/products';
import { apiErrorMessage } from '@/lib/api/client';

interface ProductColorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: CatalogProduct | null;
  // The color to view or edit; null adds a new color to the product
  color: CatalogColor | null;
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

// The color layer: what orders, purchases and stock refer to
export const ProductColorDialog: React.FC<ProductColorDialogProps> = ({ open, onOpenChange, product, color, readOnly = false }) => {
  const queryClient = useQueryClient();
  const { organizationId } = useCurrentOrganization();
  const [form, setForm] = useState<ColorForm>(toForm(color));
  const [saving, setSaving] = useState(false);
  const isNew = color === null;

  // Reset when the dialog opens on a color, not when a background refetch replaces the same color
  useEffect(() => {
    if (open) setForm(toForm(color));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, color?.id]);

  if (!product) return null;

  const refresh = () => queryClient.invalidateQueries({ queryKey: [PRODUCT_CATALOG_QUERY_KEY] });
  const threshold = form.stockThreshold.trim() === '' ? null : Number(form.stockThreshold);
  const hexValid = form.colorHex.trim() === '' || HEX_PATTERN.test(form.colorHex.trim());

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
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
      } else {
        const original = toForm(color);
        const changes: ProductColorChanges = {};
        if (form.color.trim() !== original.color) changes.color = form.color;
        if (form.colorCode.trim() !== original.colorCode) changes.color_code = form.colorCode;
        if (form.colorHex.trim() !== original.colorHex) changes.color_hex = form.colorHex;
        if (form.stockThreshold.trim() !== original.stockThreshold) changes.stock_threshold = threshold;
        if (Object.keys(changes).length === 0) {
          onOpenChange(false);
          return;
        }
        await updateProductColor(organizationId, color.id, changes);
        toast.success('顏色已更新');
      }
      await refresh();
      onOpenChange(false);
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
      onOpenChange(false);
    } catch (error) {
      toast.error(`變更狀態失敗：${apiErrorMessage(error)}`);
    } finally {
      setSaving(false);
    }
  };

  const title = isNew ? '新增顏色' : readOnly ? '顏色詳情' : '編輯顏色';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          {color && (
            <RecordAuditHistoryButton
              recordId={color.id}
              creation={{ tableName: 'products_new', createdBy: color.createdBy, createdAt: color.createdAt }}
              className="absolute right-10 top-2"
            />
          )}
          <DialogTitle className="flex items-center gap-2">
            {title}
            {color && !color.isActive && <Badge variant="outline" className="border-gray-300 text-gray-600">已停用</Badge>}
          </DialogTitle>
          <DialogDescription>產品：{product.name}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <fieldset disabled={readOnly || saving} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="color-name">顏色 *</Label>
                <Input
                  id="color-name"
                  value={form.color}
                  onChange={(e) => setForm({ ...form, color: e.target.value })}
                  placeholder="如：米白"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="color-code">色號</Label>
                <Input
                  id="color-code"
                  value={form.colorCode}
                  onChange={(e) => setForm({ ...form, colorCode: e.target.value })}
                  placeholder="如：W01"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="color-hex">色值</Label>
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
                {!hexValid && <p className="text-xs text-red-600">請使用 #RRGGBB 格式</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="color-threshold">安全庫存（{product.unitOfMeasure}）</Label>
                <Input
                  id="color-threshold"
                  type="number"
                  min="0"
                  step="0.1"
                  value={form.stockThreshold}
                  onChange={(e) => setForm({ ...form, stockThreshold: e.target.value })}
                  placeholder="如：100"
                />
              </div>
            </div>

            {color && (
              <div className="rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-700">
                目前庫存：{color.stockQuantity.toLocaleString('zh-TW')} {product.unitOfMeasure}（{color.stockRolls} 卷）
              </div>
            )}
          </fieldset>

          <div className="flex items-center justify-between gap-2 pt-4">
            {color && !readOnly ? (
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={handleToggleActive}
                disabled={saving}
                aria-label={color.isActive ? '停用顏色' : '啟用顏色'}
                title={color.isActive ? '停用顏色' : '啟用顏色'}
              >
                {color.isActive ? <PowerOff className="h-4 w-4" /> : <Power className="h-4 w-4" />}
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {readOnly ? '關閉' : '取消'}
              </Button>
              {!readOnly && (
                <Button type="submit" disabled={saving || !form.color.trim() || !hexValid}>
                  {saving ? '儲存中...' : isNew ? '新增' : '儲存'}
                </Button>
              )}
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
