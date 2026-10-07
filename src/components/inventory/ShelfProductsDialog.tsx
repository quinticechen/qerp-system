import React from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useShelfProducts, type Shelf } from '@/hooks/useShelves';

interface ShelfProductsDialogProps {
  shelf: Shelf | null;
  onOpenChange: (open: boolean) => void;
}

const QUALITY_LABELS: Record<string, string> = {
  A: 'A級',
  B: 'B級',
  C: 'C級',
  D: 'D級',
  defective: '瑕疵品',
};

export const ShelfProductsDialog: React.FC<ShelfProductsDialogProps> = ({ shelf, onOpenChange }) => {
  const { data: products, isLoading, error } = useShelfProducts(shelf?.id ?? null);

  const totalRolls = products?.reduce((sum, p) => sum + p.rollCount, 0) ?? 0;
  const totalQuantity = products?.reduce((sum, p) => sum + p.totalQuantity, 0) ?? 0;

  return (
    <Dialog open={!!shelf} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-gray-900">貨架：{shelf?.name}</DialogTitle>
          <DialogDescription className="text-gray-700">
            此貨架目前存放的產品與數量（僅計算尚有庫存的布卷）
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <p className="py-8 text-center text-gray-500">載入中...</p>
        ) : error ? (
          <p className="py-8 text-center text-red-600">載入失敗：{(error as Error).message}</p>
        ) : !products || products.length === 0 ? (
          <p className="py-8 text-center text-gray-500">此貨架目前沒有存放任何產品</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>產品</TableHead>
                <TableHead>顏色</TableHead>
                <TableHead>品級</TableHead>
                <TableHead className="text-right">卷數</TableHead>
                <TableHead className="text-right">數量 (kg)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {products.map((product) => (
                <TableRow key={product.productId}>
                  <TableCell className="font-medium text-gray-900">{product.productName}</TableCell>
                  <TableCell className="text-gray-700">
                    {product.color || '-'}
                    {product.colorCode && <span className="ml-1 text-xs text-gray-500">({product.colorCode})</span>}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {product.qualities.map((quality) => (
                        <Badge key={quality} variant="outline">
                          {QUALITY_LABELS[quality] ?? quality}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">{product.rollCount}</TableCell>
                  <TableCell className="text-right">{product.totalQuantity.toFixed(2)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell colSpan={3}>合計</TableCell>
                <TableCell className="text-right">{totalRolls}</TableCell>
                <TableCell className="text-right">{totalQuantity.toFixed(2)}</TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        )}
      </DialogContent>
    </Dialog>
  );
};
