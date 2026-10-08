import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Pencil, Plus, Search } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useCurrentOrganization } from '@/hooks/useCurrentOrganization';
import { usePermissions } from '@/hooks/usePermissions';
import { useProductCatalog, type CatalogColor, type CatalogProduct } from '@/hooks/useProductCatalog';
import { PRODUCT_CATEGORIES } from '@/lib/api/products';
import { cn } from '@/lib/utils';
import { ProductGroupDialog } from './ProductGroupDialog';
import { ProductColorDialog } from './ProductColorDialog';

type StatusFilter = 'all' | 'active' | 'inactive';

const formatQuantity = (value: number) => value.toLocaleString('zh-TW', { maximumFractionDigits: 2 });

const StatusBadge = ({ active }: { active: boolean }) => (
  <Badge
    variant="outline"
    className={active ? 'border-green-200 bg-green-100 text-green-800' : 'border-gray-300 bg-gray-100 text-gray-600'}
  >
    {active ? '啟用' : '停用'}
  </Badge>
);

const ColorSwatch = ({ hex }: { hex: string | null }) => (
  <span
    className={cn('inline-block h-4 w-4 shrink-0 rounded-full border', hex ? 'border-gray-300' : 'border-dashed border-gray-300')}
    style={hex ? { backgroundColor: hex } : undefined}
  />
);

const ProductList = () => {
  const { hasOrganization } = useCurrentOrganization();
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('canEditProducts');
  const canCreate = hasPermission('canCreateProducts');
  const { data: products = [], isLoading, error } = useProductCatalog();

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const [productDialog, setProductDialog] = useState<string | null>(null);
  const [colorDialog, setColorDialog] = useState<{ productId: string; colorId: string | null } | null>(null);

  const keyword = search.trim().toLowerCase();

  // Products matching the filters, each with the colors to show; a search on a color shows only matching colors
  const rows = useMemo(() => {
    return products
      .filter((product) => category === 'all' || product.category === category)
      .filter((product) => status === 'all' || product.isActive === (status === 'active'))
      .map((product) => {
        if (!keyword) return { product, colors: product.colors, colorMatch: false };
        const nameMatch = product.name.toLowerCase().includes(keyword);
        const colors = product.colors.filter((color) =>
          [color.color, color.colorCode].some((value) => value?.toLowerCase().includes(keyword)),
        );
        if (nameMatch) return { product, colors: product.colors, colorMatch: colors.length > 0 };
        return colors.length > 0 ? { product, colors, colorMatch: true } : null;
      })
      .filter((row): row is { product: CatalogProduct; colors: CatalogColor[]; colorMatch: boolean } => row !== null);
  }, [products, category, status, keyword]);

  const isExpanded = (productId: string, colorMatch: boolean) => expanded.has(productId) || colorMatch;

  const toggle = (productId: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  };

  const allExpanded = rows.length > 0 && rows.every(({ product }) => expanded.has(product.id));
  const toggleAll = () => setExpanded(allExpanded ? new Set() : new Set(rows.map(({ product }) => product.id)));

  // Dialogs read the latest catalog so they show fresh data after a save
  const dialogProduct = products.find((product) => product.id === (productDialog ?? colorDialog?.productId)) ?? null;
  const dialogColor = colorDialog?.colorId ? dialogProduct?.colors.find((color) => color.id === colorDialog.colorId) ?? null : null;

  if (!hasOrganization) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="text-center text-gray-700">請先選擇組織</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-gray-900">產品列表</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜尋產品名稱、顏色、色號..."
                className="pl-9"
              />
            </div>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="sm:w-32" aria-label="類別">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部類別</SelectItem>
                {PRODUCT_CATEGORIES.map((item) => (
                  <SelectItem key={item} value={item}>
                    {item}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={status} onValueChange={(value) => setStatus(value as StatusFilter)}>
              <SelectTrigger className="sm:w-32" aria-label="狀態">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部狀態</SelectItem>
                <SelectItem value="active">啟用</SelectItem>
                <SelectItem value="inactive">停用</SelectItem>
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="shrink-0"
              onClick={toggleAll}
              disabled={rows.length === 0}
              aria-label={allExpanded ? '全部收合' : '全部展開'}
              title={allExpanded ? '全部收合' : '全部展開'}
            >
              {allExpanded ? <ChevronsDownUp className="h-4 w-4" /> : <ChevronsUpDown className="h-4 w-4" />}
            </Button>
          </div>

          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10" />
                  <TableHead className="text-left">產品 / 顏色</TableHead>
                  <TableHead>色號</TableHead>
                  <TableHead>類別</TableHead>
                  <TableHead className="text-right">庫存</TableHead>
                  <TableHead className="text-right">安全庫存</TableHead>
                  <TableHead>狀態</TableHead>
                  <TableHead className="w-28" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow>
                    <TableCell colSpan={8} className="py-8 text-center text-gray-700">
                      載入中...
                    </TableCell>
                  </TableRow>
                )}
                {error && (
                  <TableRow>
                    <TableCell colSpan={8} className="py-8 text-center text-red-600">
                      載入產品失敗，請重新整理
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading && !error && rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="py-8 text-center text-gray-700">
                      沒有找到產品
                    </TableCell>
                  </TableRow>
                )}
                {rows.map(({ product, colors, colorMatch }) => {
                  const open = isExpanded(product.id, colorMatch);
                  return (
                    <React.Fragment key={product.id}>
                      <TableRow
                        className={cn('cursor-pointer bg-gray-50/60 hover:bg-gray-100', !product.isActive && 'text-gray-500')}
                        onClick={() => toggle(product.id)}
                      >
                        <TableCell>
                          {open ? <ChevronDown className="h-4 w-4 text-gray-500" /> : <ChevronRight className="h-4 w-4 text-gray-500" />}
                        </TableCell>
                        <TableCell className="text-left">
                          <span className="font-medium text-gray-900">{product.name}</span>
                          <span className="ml-2 text-xs text-gray-500">{product.colors.length} 色</span>
                          {product.lowStockCount > 0 && (
                            <Badge variant="outline" className="ml-2 border-amber-200 bg-amber-50 text-amber-700">
                              {product.lowStockCount} 色低庫存
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell />
                        <TableCell className="text-gray-700">{product.category}</TableCell>
                        <TableCell className="text-right text-gray-900">
                          {formatQuantity(product.stockQuantity)} {product.unitOfMeasure}
                        </TableCell>
                        <TableCell />
                        <TableCell>
                          <StatusBadge active={product.isActive} />
                        </TableCell>
                        <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="flex justify-end gap-1">
                            {canCreate && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                title="新增顏色"
                                aria-label={`新增顏色到 ${product.name}`}
                                onClick={() => setColorDialog({ productId: product.id, colorId: null })}
                              >
                                <Plus className="h-4 w-4" />
                              </Button>
                            )}
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              title={canEdit ? '編輯產品' : '查看產品'}
                              aria-label={`${canEdit ? '編輯' : '查看'}產品 ${product.name}`}
                              onClick={() => setProductDialog(product.id)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>

                      {open &&
                        colors.map((color) => (
                          <TableRow
                            key={color.id}
                            className={cn('cursor-pointer', (!color.isActive || !product.isActive) && 'text-gray-500')}
                            onClick={() => setColorDialog({ productId: product.id, colorId: color.id })}
                          >
                            <TableCell />
                            <TableCell>
                              <div className="flex items-center gap-2 pl-4">
                                <ColorSwatch hex={color.colorHex} />
                                <span className="text-gray-900">{color.color || '未設定顏色'}</span>
                              </div>
                            </TableCell>
                            <TableCell className="text-gray-700">{color.colorCode || '—'}</TableCell>
                            <TableCell />
                            <TableCell className={cn('text-right', color.isLowStock ? 'font-medium text-amber-700' : 'text-gray-700')}>
                              {formatQuantity(color.stockQuantity)} {product.unitOfMeasure}
                              <span className="ml-1 text-xs text-gray-500">（{color.stockRolls} 卷）</span>
                            </TableCell>
                            <TableCell className="text-right text-gray-700">
                              {color.stockThreshold == null ? '未設定' : `${formatQuantity(color.stockThreshold)} ${product.unitOfMeasure}`}
                            </TableCell>
                            <TableCell>
                              <StatusBadge active={color.isActive} />
                            </TableCell>
                            <TableCell />
                          </TableRow>
                        ))}
                    </React.Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <ProductGroupDialog
        open={productDialog !== null}
        onOpenChange={(open) => !open && setProductDialog(null)}
        product={productDialog ? dialogProduct : null}
        readOnly={!canEdit}
      />
      <ProductColorDialog
        open={colorDialog !== null}
        onOpenChange={(open) => !open && setColorDialog(null)}
        product={colorDialog ? dialogProduct : null}
        color={dialogColor}
        readOnly={colorDialog?.colorId ? !canEdit : !canCreate}
      />
    </div>
  );
};

export default ProductList;
