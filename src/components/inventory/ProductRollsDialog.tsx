import React, { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Pencil } from 'lucide-react';
import { useProductRolls } from '@/hooks/useInventoryEditing';
import { EditableRoll, EditRollDialog } from './EditRollDialog';

export interface ProductRollsTarget {
  productId: string;
  productName: string;
  color: string | null;
}

interface ProductRollsDialogProps {
  product: ProductRollsTarget | null;
  organizationId: string | null | undefined;
  onOpenChange: (open: boolean) => void;
}

const QUALITY_LABELS: Record<string, string> = {
  A: 'A級',
  B: 'B級',
  C: 'C級',
  D: 'D級',
  defective: '瑕疵',
};

export const ProductRollsDialog = ({ product, organizationId, onOpenChange }: ProductRollsDialogProps) => {
  const { data: rolls, isLoading } = useProductRolls(product?.productId ?? null);
  const [editingRoll, setEditingRoll] = useState<EditableRoll | null>(null);

  const title = product ? `${product.productName}${product.color ? ` - ${product.color}` : ''} 布卷明細` : '';

  return (
    <Dialog open={!!product} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-gray-900">{title}</DialogTitle>
          <DialogDescription className="text-gray-600">
            目前有庫存的布卷，點擊編輯可修改倉儲位置、品質與重量
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="py-4 text-center text-gray-500">載入中...</div>
        ) : !rolls || rolls.length === 0 ? (
          <div className="py-4 text-center text-gray-500">沒有庫存布卷</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>布卷編號</TableHead>
                <TableHead>採購單號</TableHead>
                <TableHead>到貨日期</TableHead>
                <TableHead>倉庫</TableHead>
                <TableHead>貨架</TableHead>
                <TableHead className="text-center">品質</TableHead>
                <TableHead className="text-right">入庫重量</TableHead>
                <TableHead className="text-right">當前重量</TableHead>
                <TableHead className="text-center">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rolls.map((roll) => (
                <TableRow key={roll.id}>
                  <TableCell className="font-medium text-gray-900">{roll.roll_number}</TableCell>
                  <TableCell className="text-gray-700">{roll.inventories?.purchase_orders?.po_number ?? '-'}</TableCell>
                  <TableCell className="text-gray-700">
                    {roll.inventories ? new Date(roll.inventories.arrival_date).toLocaleDateString('zh-TW') : '-'}
                  </TableCell>
                  <TableCell className="text-gray-700">{roll.warehouses?.name ?? '-'}</TableCell>
                  <TableCell className="text-gray-700">{roll.shelf || '-'}</TableCell>
                  <TableCell className="text-center">
                    <Badge variant="outline">{QUALITY_LABELS[roll.quality] ?? roll.quality}</Badge>
                  </TableCell>
                  <TableCell className="text-right text-gray-900">{roll.quantity.toFixed(2)}</TableCell>
                  <TableCell className="text-right text-gray-900">{roll.current_quantity.toFixed(2)}</TableCell>
                  <TableCell className="text-center">
                    <Button variant="ghost" size="sm" aria-label="編輯布卷" onClick={() => setEditingRoll(roll)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </DialogContent>

      <EditRollDialog
        roll={editingRoll}
        organizationId={organizationId}
        onOpenChange={(isOpen) => !isOpen && setEditingRoll(null)}
      />
    </Dialog>
  );
};
