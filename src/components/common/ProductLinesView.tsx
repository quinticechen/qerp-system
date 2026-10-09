import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export interface ProductLineView {
  key: string;
  product: string;
  quantity: number;
  unitPrice: number;
  rolls?: number | null;
  // Progress shown under the product, e.g.「已出貨 40 公斤」「入庫 2026/10/9」
  notes?: string[];
}

interface ProductLinesViewProps {
  lines: ProductLineView[];
  quantityLabel: string;
  totalLabel: string;
  showRolls?: boolean;
}

// The read-only counterpart of ProductLineItemsEditor, for the view mode of orders and purchase orders
export const ProductLinesView = ({ lines, quantityLabel, totalLabel, showRolls = false }: ProductLinesViewProps) => {
  const total = lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);

  return (
    <div className="space-y-3">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[40%]">產品</TableHead>
            <TableHead className="text-right">{quantityLabel}</TableHead>
            {showRolls && <TableHead className="text-right">卷數</TableHead>}
            <TableHead className="text-right">單價</TableHead>
            <TableHead className="text-right">小計</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {lines.length === 0 ? (
            <TableRow>
              <TableCell colSpan={showRolls ? 5 : 4} className="text-center text-gray-500">
                沒有產品
              </TableCell>
            </TableRow>
          ) : (
            lines.map((line) => (
              <TableRow key={line.key}>
                <TableCell className="space-y-1">
                  <div className="text-gray-900">{line.product}</div>
                  {line.notes && line.notes.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {line.notes.map((note) => (
                        <Badge key={note} variant="outline" className="border-gray-200 bg-gray-50 font-normal text-gray-700">
                          {note}
                        </Badge>
                      ))}
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-right text-gray-900">{line.quantity.toLocaleString()}</TableCell>
                {showRolls && <TableCell className="text-right text-gray-900">{line.rolls ?? '-'}</TableCell>}
                <TableCell className="text-right text-gray-900">${line.unitPrice.toLocaleString()}</TableCell>
                <TableCell className="text-right text-gray-900">${(line.quantity * line.unitPrice).toLocaleString()}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      <div className="text-right text-sm font-medium text-gray-900">
        {totalLabel}：${total.toLocaleString()}
      </div>
    </div>
  );
};
