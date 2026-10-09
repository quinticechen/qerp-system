import React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EditableShippingItem, ShippableRoll, newShippingItem } from '@/hooks/useShippingItems';
import { productLabel } from '@/hooks/useProductOptions';
import { QUALITY_OPTIONS } from '@/lib/fabricQuality';
import { NumberInput } from '@/components/common/NumberInput';

interface ShippingItemsEditorProps {
  items: EditableShippingItem[];
  onChange: (items: EditableShippingItem[]) => void;
  rolls: ShippableRoll[];
  capacityOf: (rollId: string) => number;
}

const qualityLabel = (quality: string) => QUALITY_OPTIONS.find((option) => option.value === quality)?.label ?? quality;

export const ShippingItemsEditor = ({ items, onChange, rolls, capacityOf }: ShippingItemsEditorProps) => {
  const updateItem = (key: string, changes: Partial<EditableShippingItem>) =>
    onChange(items.map((item) => (item.key === key ? { ...item, ...changes } : item)));

  const totalWeight = items.reduce((sum, item) => sum + (Number(item.shipped_quantity) || 0), 0);

  return (
    <div className="space-y-3">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[55%]">布卷</TableHead>
            <TableHead>出貨重量（公斤）</TableHead>
            <TableHead className="w-12" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item, index) => {
            const position = index + 1;
            // A roll can appear only once; other rows' rolls are not offered again
            const takenElsewhere = new Set(items.filter((other) => other.key !== item.key).map((other) => other.inventory_roll_id));
            const options = rolls.filter((roll) => !takenElsewhere.has(roll.id));

            return (
              <TableRow key={item.key}>
                <TableCell>
                  <Select value={item.inventory_roll_id} onValueChange={(value) => updateItem(item.key, { inventory_roll_id: value })}>
                    <SelectTrigger aria-label={`第 ${position} 卷布卷`}>
                      <SelectValue placeholder="選擇布卷" />
                    </SelectTrigger>
                    <SelectContent>
                      {options.map((roll) => (
                        <SelectItem key={roll.id} value={roll.id}>
                          {`${roll.roll_number}｜${roll.products_new ? productLabel(roll.products_new) : ''}｜${qualityLabel(roll.quality)}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell className="space-y-1">
                  <NumberInput
                    aria-label={`第 ${position} 卷出貨重量（公斤）`}
                    value={item.shipped_quantity}
                    onValueChange={(value) => updateItem(item.key, { shipped_quantity: value })}
                  />
                  {item.inventory_roll_id && (
                    <span className="block text-xs text-gray-500">最多 {capacityOf(item.inventory_roll_id)} 公斤</span>
                  )}
                </TableCell>
                <TableCell>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`刪除第 ${position} 卷`}
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
        <Button type="button" variant="outline" onClick={() => onChange([...items, newShippingItem()])} size="icon" aria-label="新增出貨布卷" title="新增出貨布卷">
          <Plus className="h-4 w-4" />
        </Button>
        <span className="text-sm font-medium text-gray-900">
          共 {items.length} 卷，{totalWeight.toFixed(2)} 公斤
        </span>
      </div>
    </div>
  );
};
