import React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EditableInventoryRoll, NamedOption, newInventoryRoll } from '@/hooks/useInventoryEditing';
import { ProductOption, productLabel } from '@/hooks/useProductOptions';
import { FabricQuality, QUALITY_OPTIONS } from '@/lib/fabricQuality';

interface InventoryRollsEditorProps {
  rolls: EditableInventoryRoll[];
  onChange: (rolls: EditableInventoryRoll[]) => void;
  products: ProductOption[];
  warehouses: NamedOption[];
}

export const InventoryRollsEditor = ({ rolls, onChange, products, warehouses }: InventoryRollsEditorProps) => {
  const updateRoll = (key: string, changes: Partial<EditableInventoryRoll>) =>
    onChange(rolls.map((roll) => (roll.key === key ? { ...roll, ...changes } : roll)));

  const totalWeight = rolls.reduce((sum, roll) => sum + (Number(roll.quantity) || 0), 0);

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>布卷編號</TableHead>
              <TableHead className="min-w-[160px]">產品</TableHead>
              <TableHead className="min-w-[120px]">倉庫</TableHead>
              <TableHead>貨架</TableHead>
              <TableHead className="min-w-[100px]">品質</TableHead>
              <TableHead>入庫重量（公斤）</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rolls.map((roll, index) => {
              const position = index + 1;
              const isShipped = roll.shipped > 0;

              return (
                <TableRow key={roll.key}>
                  <TableCell className="space-y-1">
                    {roll.id ? (
                      <span className="font-medium text-gray-900">{roll.roll_number}</span>
                    ) : (
                      <Input
                        aria-label={`第 ${position} 卷布卷編號`}
                        value={roll.roll_number}
                        onChange={(e) => updateRoll(roll.key, { roll_number: e.target.value })}
                      />
                    )}
                    {isShipped && (
                      <Badge variant="outline" className="border-orange-200 bg-orange-50 text-orange-700">
                        已出貨 {roll.shipped} 公斤
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Select
                      value={roll.product_id}
                      onValueChange={(value) => updateRoll(roll.key, { product_id: value })}
                      disabled={isShipped}
                    >
                      <SelectTrigger aria-label={`第 ${position} 卷產品`}>
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
                  </TableCell>
                  <TableCell>
                    <Select value={roll.warehouse_id} onValueChange={(value) => updateRoll(roll.key, { warehouse_id: value })}>
                      <SelectTrigger aria-label={`第 ${position} 卷倉庫`}>
                        <SelectValue placeholder="選擇倉庫" />
                      </SelectTrigger>
                      <SelectContent>
                        {warehouses.map((warehouse) => (
                          <SelectItem key={warehouse.id} value={warehouse.id}>
                            {warehouse.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Input
                      aria-label={`第 ${position} 卷貨架`}
                      value={roll.shelf}
                      onChange={(e) => updateRoll(roll.key, { shelf: e.target.value })}
                      placeholder="例如 A-01"
                    />
                  </TableCell>
                  <TableCell>
                    <Select value={roll.quality} onValueChange={(value) => updateRoll(roll.key, { quality: value as FabricQuality })}>
                      <SelectTrigger aria-label={`第 ${position} 卷品質`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {QUALITY_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      min={roll.shipped}
                      step="0.01"
                      aria-label={`第 ${position} 卷入庫重量（公斤）`}
                      value={roll.quantity}
                      onChange={(e) => updateRoll(roll.key, { quantity: e.target.value })}
                    />
                  </TableCell>
                  <TableCell>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={`刪除第 ${position} 卷`}
                      title={isShipped ? '已出貨的布卷不可刪除' : undefined}
                      disabled={isShipped}
                      onClick={() => onChange(rolls.filter((other) => other.key !== roll.key))}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between">
        <Button type="button" variant="outline" onClick={() => onChange([...rolls, newInventoryRoll()])} size="icon" aria-label="新增布卷" title="新增布卷">
          <Plus className="h-4 w-4" />
        </Button>
        <span className="text-sm font-medium text-gray-900">
          共 {rolls.length} 卷，{totalWeight.toFixed(2)} 公斤
        </span>
      </div>
    </div>
  );
};
