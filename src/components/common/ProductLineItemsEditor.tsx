import React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ProductOption, productLabel } from '@/hooks/useProductOptions';
import { NumberInput } from '@/components/common/NumberInput';

// Form state shared by order and purchase lines; numbers stay strings while the user types
export interface ProductLineItem {
  key: string;
  id?: string;
  product_id: string;
  quantity: string;
  unit_price: string;
  rolls?: string;
}

export interface LineItemLock {
  // Why the line is locked (shown as badges); an empty list means it is freely editable
  reasons: string[];
  // Quantity may not go below what later steps already consumed
  minQuantity: number;
}

interface ProductLineItemsEditorProps<T extends ProductLineItem> {
  items: T[];
  onChange: (items: T[]) => void;
  products: ProductOption[];
  createItem: () => T;
  getLock: (item: T) => LineItemLock;
  quantityLabel: string;
  totalLabel: string;
  showRolls?: boolean;
}

export const ProductLineItemsEditor = <T extends ProductLineItem>({
  items,
  onChange,
  products,
  createItem,
  getLock,
  quantityLabel,
  totalLabel,
  showRolls = false,
}: ProductLineItemsEditorProps<T>) => {
  const updateItem = (key: string, changes: Partial<T>) =>
    onChange(items.map((item) => (item.key === key ? { ...item, ...changes } : item)));

  const total = items.reduce((sum, item) => sum + (Number(item.quantity) || 0) * (Number(item.unit_price) || 0), 0);

  return (
    <div className="space-y-3">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[36%]">產品</TableHead>
            <TableHead>{quantityLabel}</TableHead>
            {showRolls && <TableHead>卷數</TableHead>}
            <TableHead>單價</TableHead>
            <TableHead className="text-right">小計</TableHead>
            <TableHead className="w-12" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item, index) => {
            const position = index + 1;
            const lock = getLock(item);
            const isLocked = lock.reasons.length > 0;
            const subtotal = (Number(item.quantity) || 0) * (Number(item.unit_price) || 0);

            return (
              <TableRow key={item.key}>
                <TableCell className="space-y-1">
                  <Select
                    value={item.product_id}
                    onValueChange={(value) => updateItem(item.key, { product_id: value } as Partial<T>)}
                    disabled={isLocked}
                  >
                    <SelectTrigger aria-label={`第 ${position} 項產品`}>
                      <SelectValue placeholder="選擇產品" />
                    </SelectTrigger>
                    <SelectContent>
                      {products.map((product) => (
                        <SelectItem key={product.id} value={product.id}>
                          {productLabel(product)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {isLocked && (
                    <div className="flex flex-wrap gap-1">
                      {lock.reasons.map((reason) => (
                        <Badge key={reason} variant="outline" className="border-orange-200 bg-orange-50 text-orange-700">
                          {reason}
                        </Badge>
                      ))}
                    </div>
                  )}
                </TableCell>
                <TableCell>
                  <NumberInput
                    aria-label={`第 ${position} 項${quantityLabel}`}
                    value={item.quantity}
                    onValueChange={(value) => updateItem(item.key, { quantity: value } as Partial<T>)}
                  />
                </TableCell>
                {showRolls && (
                  <TableCell>
                    <NumberInput
                      decimals={0}
                      aria-label={`第 ${position} 項卷數`}
                      value={item.rolls ?? ''}
                      onValueChange={(value) => updateItem(item.key, { rolls: value } as Partial<T>)}
                    />
                  </TableCell>
                )}
                <TableCell>
                  <NumberInput
                    aria-label={`第 ${position} 項單價`}
                    value={item.unit_price}
                    onValueChange={(value) => updateItem(item.key, { unit_price: value } as Partial<T>)}
                  />
                </TableCell>
                <TableCell className="text-right text-gray-900">${subtotal.toLocaleString()}</TableCell>
                <TableCell>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`刪除第 ${position} 項`}
                    title={isLocked ? `${lock.reasons.join('、')}，不可刪除` : undefined}
                    disabled={isLocked}
                    onClick={() => onChange(items.filter((other) => other.key !== item.key))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      <div className="flex items-center justify-between">
        <Button type="button" variant="outline" onClick={() => onChange([...items, createItem()])} size="icon" aria-label="新增產品" title="新增產品">
          <Plus className="h-4 w-4" />
        </Button>
        <span className="text-sm font-medium text-gray-900">
          {totalLabel}：${total.toLocaleString()}
        </span>
      </div>
    </div>
  );
};
