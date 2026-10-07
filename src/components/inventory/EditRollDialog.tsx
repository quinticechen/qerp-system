import React, { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useUpdateInventoryRoll, useWarehouseOptions } from '@/hooks/useInventoryEditing';
import type { RollEdits } from '@/lib/inventoryService';
import { FabricQuality, QUALITY_OPTIONS } from '@/lib/fabricQuality';

export interface EditableRoll {
  id: string;
  roll_number: string;
  quantity: number;
  current_quantity: number;
  quality: FabricQuality;
  warehouse_id: string;
  shelf: string | null;
}

interface EditRollDialogProps {
  roll: EditableRoll | null;
  organizationId: string | null | undefined;
  onOpenChange: (open: boolean) => void;
}

export const EditRollDialog = ({ roll, organizationId, onOpenChange }: EditRollDialogProps) => {
  const { toast } = useToast();
  const { data: warehouses } = useWarehouseOptions(organizationId);
  const updateRoll = useUpdateInventoryRoll();
  const [warehouseId, setWarehouseId] = useState('');
  const [shelf, setShelf] = useState('');
  const [quality, setQuality] = useState<FabricQuality>('A');
  const [quantity, setQuantity] = useState('');

  useEffect(() => {
    if (!roll) return;
    setWarehouseId(roll.warehouse_id);
    setShelf(roll.shelf ?? '');
    setQuality(roll.quality);
    setQuantity(String(roll.quantity));
    updateRoll.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roll]);

  if (!roll) return null;

  const shipped = roll.quantity - roll.current_quantity;
  const parsedQuantity = Number(quantity);
  const quantityIsValid = quantity.trim() !== '' && Number.isFinite(parsedQuantity) && parsedQuantity > 0;
  const previewCurrent = quantityIsValid ? parsedQuantity - shipped : roll.current_quantity;

  const handleSave = () => {
    if (!quantityIsValid) {
      toast({ title: '請輸入正確的入庫重量', variant: 'destructive' });
      return;
    }

    // Only send fields the user actually changed
    const edits: RollEdits = {};
    if (warehouseId !== roll.warehouse_id) edits.warehouse_id = warehouseId;
    const trimmedShelf = shelf.trim() || null;
    if (trimmedShelf !== roll.shelf) edits.shelf = trimmedShelf;
    if (quality !== roll.quality) edits.quality = quality;
    if (parsedQuantity !== roll.quantity) edits.quantity = parsedQuantity;

    if (Object.keys(edits).length === 0) {
      onOpenChange(false);
      return;
    }

    updateRoll.mutate(
      { roll, edits },
      {
        onSuccess: () => {
          toast({ title: '已更新布卷', description: roll.roll_number });
          onOpenChange(false);
        },
      },
    );
  };

  return (
    <Dialog open={!!roll} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-gray-900">編輯布卷 {roll.roll_number}</DialogTitle>
          <DialogDescription className="text-gray-600">
            修改倉儲位置、品質與重量。已出貨 {shipped.toFixed(2)} 公斤會保留不變。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="roll-warehouse" className="text-gray-700">倉庫</Label>
              <Select value={warehouseId} onValueChange={setWarehouseId}>
                <SelectTrigger id="roll-warehouse">
                  <SelectValue placeholder="選擇倉庫" />
                </SelectTrigger>
                <SelectContent>
                  {warehouses?.map((warehouse) => (
                    <SelectItem key={warehouse.id} value={warehouse.id}>
                      {warehouse.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="roll-shelf" className="text-gray-700">貨架</Label>
              <Input id="roll-shelf" value={shelf} onChange={(e) => setShelf(e.target.value)} placeholder="例如 A-01" />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="roll-quality" className="text-gray-700">品質</Label>
            <Select value={quality} onValueChange={(value) => setQuality(value as FabricQuality)}>
              <SelectTrigger id="roll-quality">
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
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="roll-quantity" className="text-gray-700">入庫重量（公斤）</Label>
              <Input
                id="roll-quantity"
                type="number"
                min="0"
                step="0.01"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-gray-700">當前重量（公斤）</Label>
              <p className="flex h-10 items-center text-gray-900">{previewCurrent.toFixed(2)}</p>
            </div>
          </div>

          {updateRoll.error && (
            <p role="alert" className="text-sm text-red-600">{updateRoll.error.message}</p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={updateRoll.isPending}>
              取消
            </Button>
            <Button
              onClick={handleSave}
              disabled={updateRoll.isPending}
              className="bg-blue-600 text-white hover:bg-blue-700"
            >
              {updateRoll.isPending ? '儲存中...' : '儲存'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
