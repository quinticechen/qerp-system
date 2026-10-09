import React, { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useProductRolls } from '@/hooks/useInventoryEditing';
import { RecordDialog } from '@/components/common/RecordDialog';
import { RollDialog } from './RollDialog';

export interface ProductRollsTarget {
  productId: string;
  productName: string;
  color: string | null;
}

interface ProductRollsDialogProps {
  product: ProductRollsTarget | null;
  organizationId: string | null | undefined;
  onOpenChange: (open: boolean) => void;
  // Open rolls without the 編輯 button (members without canEditInventory)
  readOnly?: boolean;
}

const QUALITY_LABELS: Record<string, string> = {
  A: 'A級',
  B: 'B級',
  C: 'C級',
  D: 'D級',
  defective: '瑕疵',
};

// The rolls of one product that hold stock; a row opens the roll
export const ProductRollsDialog = ({ product, organizationId, onOpenChange, readOnly = false }: ProductRollsDialogProps) => {
  const { data: rolls, isLoading } = useProductRolls(product?.productId ?? null);
  const [openRollId, setOpenRollId] = useState<string | null>(null);
  const openRoll = rolls?.find((roll) => roll.id === openRollId) ?? null;

  const title = product ? `${product.productName}${product.color ? ` - ${product.color}` : ''} 布卷明細` : '';

  return (
    <>
      <RecordDialog open={!!product} onOpenChange={onOpenChange} mode="view" title={title} description="目前有庫存的布卷，點選布卷查看或編輯" size="xl">
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
              </TableRow>
            </TableHeader>
            <TableBody>
              {rolls.map((roll) => (
                <TableRow key={roll.id} className="cursor-pointer" onClick={() => setOpenRollId(roll.id)}>
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
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </RecordDialog>

      <RollDialog
        roll={openRoll}
        organizationId={organizationId}
        onOpenChange={(isOpen) => !isOpen && setOpenRollId(null)}
        canEdit={!readOnly}
      />
    </>
  );
};
