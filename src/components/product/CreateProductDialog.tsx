import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { RecordDialog } from '@/components/common/RecordDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Trash2, Plus } from 'lucide-react';
import { useCurrentOrganization } from '@/hooks/useCurrentOrganization';
import { PRODUCT_CATALOG_QUERY_KEY } from '@/hooks/useProductCatalog';
import { createProduct, PRODUCT_CATEGORIES } from '@/lib/api/products';
import { apiErrorMessage } from '@/lib/api/client';
import { NumberInput } from '@/components/common/NumberInput';

interface CreateProductDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onProductCreated?: () => void;
}

interface ColorRow {
  key: string;
  color: string;
  colorCode: string;
  colorHex: string;
  stockThreshold: string;
}

const HEX_PATTERN = /^#[0-9A-Fa-f]{6}$/;

// Queries that list products; all of them show the new product's colors
const PRODUCT_QUERY_KEYS = [PRODUCT_CATALOG_QUERY_KEY, 'products', 'all-products', 'product-options'];

const emptyRow = (): ColorRow => ({ key: crypto.randomUUID(), color: '', colorCode: '', colorHex: '', stockThreshold: '' });

// A new product with one or more colors, created in one call
export const CreateProductDialog: React.FC<CreateProductDialogProps> = ({
  open,
  onOpenChange,
  onProductCreated,
}) => {
  const queryClient = useQueryClient();
  const { organizationId } = useCurrentOrganization();
  const [productName, setProductName] = useState('');
  const [category, setCategory] = useState('布料');
  const [colors, setColors] = useState<ColorRow[]>([emptyRow()]);
  const [loading, setLoading] = useState(false);

  const updateColor = (key: string, field: keyof Omit<ColorRow, 'key'>, value: string) => {
    setColors(colors.map((row) => (row.key === key ? { ...row, [field]: value } : row)));
  };

  const invalidHex = colors.some((row) => row.colorHex.trim() !== '' && !HEX_PATTERN.test(row.colorHex.trim()));
  const canSubmit = productName.trim() !== '' && colors.every((row) => row.color.trim() !== '') && !invalidHex;

  const resetForm = () => {
    setProductName('');
    setCategory('布料');
    setColors([emptyRow()]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!organizationId) {
      toast.error('請先選擇組織');
      return;
    }

    setLoading(true);
    try {
      await createProduct(organizationId, {
        name: productName,
        category,
        colors: colors.map((row) => ({
          color: row.color,
          color_code: row.colorCode,
          color_hex: row.colorHex,
          stock_threshold: row.stockThreshold.trim() === '' ? null : Number(row.stockThreshold),
        })),
      });
      toast.success(`已新增產品「${productName.trim()}」，共 ${colors.length} 個顏色`);
      await Promise.all(PRODUCT_QUERY_KEYS.map((key) => queryClient.invalidateQueries({ queryKey: [key] })));
      resetForm();
      onOpenChange(false);
      onProductCreated?.();
    } catch (error) {
      toast.error(`新增產品失敗：${apiErrorMessage(error)}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <RecordDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) resetForm();
        onOpenChange(next);
      }}
      mode="create"
      title="新增產品"
      description="一個產品可以有多個顏色；同名產品已存在時，請到產品列表在該產品下新增顏色"
      size="xl"
      formId="create-product-form"
      submitting={loading}
      submitDisabled={!canSubmit}
      submitLabel={`新增產品（${colors.length} 個顏色）`}
    >
        <form id="create-product-form" onSubmit={handleSubmit} className="space-y-6">
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
                <SelectTrigger id="category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRODUCT_CATEGORIES.map((cat) => (
                    <SelectItem key={cat} value={cat}>
                      {cat}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <Label>顏色</Label>
              <Button
                type="button"
                onClick={() => setColors([...colors, emptyRow()])}
                size="icon"
                variant="outline"
                aria-label="新增顏色"
                title="新增顏色"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>

            <div className="border rounded-lg">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>顏色 *</TableHead>
                    <TableHead>色號</TableHead>
                    <TableHead>色值</TableHead>
                    <TableHead>安全庫存 (KG)</TableHead>
                    <TableHead className="w-16">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {colors.map((row, index) => (
                    <TableRow key={row.key}>
                      <TableCell>
                        <Input
                          value={row.color}
                          onChange={(e) => updateColor(row.key, 'color', e.target.value)}
                          placeholder="如：米白"
                          aria-label={`顏色 ${index + 1}`}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          value={row.colorCode}
                          onChange={(e) => updateColor(row.key, 'colorCode', e.target.value)}
                          placeholder="如：W01"
                          aria-label={`色號 ${index + 1}`}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Input
                            type="color"
                            aria-label={`選擇色值 ${index + 1}`}
                            value={HEX_PATTERN.test(row.colorHex) ? row.colorHex : '#ffffff'}
                            onChange={(e) => updateColor(row.key, 'colorHex', e.target.value.toUpperCase())}
                            className="h-10 w-12 shrink-0 cursor-pointer p-1"
                          />
                          <Input
                            value={row.colorHex}
                            onChange={(e) => updateColor(row.key, 'colorHex', e.target.value)}
                            placeholder="#RRGGBB"
                            aria-label={`色值 ${index + 1}`}
                            aria-invalid={row.colorHex.trim() !== '' && !HEX_PATTERN.test(row.colorHex.trim())}
                          />
                        </div>
                      </TableCell>
                      <TableCell>
                        <NumberInput
                          value={row.stockThreshold}
                          onValueChange={(value) => updateColor(row.key, 'stockThreshold', value)}
                          placeholder="如：100"
                          aria-label={`安全庫存 ${index + 1}`}
                        />
                      </TableCell>
                      <TableCell>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setColors(colors.filter((item) => item.key !== row.key))}
                          disabled={colors.length === 1}
                          aria-label={`刪除顏色 ${index + 1}`}
                          title="刪除顏色"
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
              {invalidHex ? (
                <p className="text-red-600">• 色值請使用 #RRGGBB 格式</p>
              ) : (
                <>
                  <p>• 新增的產品和顏色狀態為「啟用」，計量單位為「KG」，之後可以在產品列表修改</p>
                  <p>• 色值用於列表顯示的色塊，可留空</p>
                </>
              )}
            </div>
          </div>
        </form>
    </RecordDialog>
  );
};
