import React, { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useUpdateInventoryRoll, useWarehouseOptions, type ProductRoll } from '@/hooks/useInventoryEditing';
import type { RollEdits } from '@/lib/inventoryService';
import { FabricQuality, QUALITY_OPTIONS } from '@/lib/fabricQuality';
import { RecordDialog } from '@/components/common/RecordDialog';
import { DetailSection } from '@/components/common/DetailSection';
import { DetailField } from '@/components/common/DetailField';
import { FormField } from '@/components/common/FormField';
import { NumberInput } from '@/components/common/NumberInput';

interface RollDialogProps {
  // Pass the row from the latest list data so the view shows saved changes
  roll: ProductRoll | null;
  organizationId: string | null | undefined;
  onOpenChange: (open: boolean) => void;
  canEdit: boolean;
}

const qualityLabel = (quality: string) => QUALITY_OPTIONS.find((option) => option.value === quality)?.label ?? quality;

// One roll of stock: where it is, its grade and weight; the shipped weight stays fixed when the weight changes
export const RollDialog = ({ roll, organizationId, onOpenChange, canEdit }: RollDialogProps) => {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const { data: warehouses } = useWarehouseOptions(editing ? organizationId : null);
  const updateRoll = useUpdateInventoryRoll();
  const [warehouseId, setWarehouseId] = useState('');
  const [shelf, setShelf] = useState('');
  const [quality, setQuality] = useState<FabricQuality>('A');
  const [quantity, setQuantity] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    setEditing(false);
  }, [roll?.id]);

  if (!roll) return null;

  const shipped = roll.quantity - roll.current_quantity;
  const parsedQuantity = Number(quantity);
  const quantityIsValid = quantity.trim() !== '' && parsedQuantity > 0;
  const previewCurrent = quantityIsValid ? parsedQuantity - shipped : roll.current_quantity;

  const startEditing = () => {
    setWarehouseId(roll.warehouse_id);
    setShelf(roll.shelf ?? '');
    setQuality(roll.quality);
    setQuantity(String(roll.quantity));
    setSaveError(null);
    setEditing(true);
  };

  const handleSave = () => {
    if (!quantityIsValid) {
      setSaveError('請輸入正確的入庫重量');
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
      setEditing(false);
      return;
    }
    if (!organizationId) return;

    setSaveError(null);
    updateRoll.mutate(
      { organizationId, roll, edits },
      {
        onSuccess: () => {
          toast({ title: '已更新布卷', description: roll.roll_number });
          setEditing(false);
        },
        onError: (error: Error) => setSaveError(error.message),
      },
    );
  };

  return (
    <RecordDialog
      open
      onOpenChange={onOpenChange}
      mode={editing ? 'edit' : 'view'}
      title={editing ? `編輯布卷 ${roll.roll_number}` : `布卷 ${roll.roll_number}`}
      description={editing ? `已出貨 ${shipped.toFixed(2)} 公斤會保留不變` : undefined}
      history={{ recordId: roll.id }}
      onEdit={canEdit ? startEditing : undefined}
      onCancelEdit={() => setEditing(false)}
      onSubmit={handleSave}
      submitting={updateRoll.isPending}
      error={saveError}
    >
      {editing ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="倉庫" htmlFor="roll-warehouse">
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
          </FormField>
          <FormField label="貨架" htmlFor="roll-shelf">
            <Input id="roll-shelf" value={shelf} onChange={(e) => setShelf(e.target.value)} placeholder="例如 A-01" />
          </FormField>
          <FormField label="品質" htmlFor="roll-quality">
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
          </FormField>
          <FormField label="入庫重量（公斤）" htmlFor="roll-quantity" hint={`當前重量 ${previewCurrent.toFixed(2)} 公斤`}>
            <NumberInput id="roll-quantity" value={quantity} onValueChange={setQuantity} />
          </FormField>
        </div>
      ) : (
        <DetailSection fields>
          <DetailField label="採購單號">{roll.inventories?.purchase_orders?.po_number}</DetailField>
          <DetailField label="到貨日期">
            {roll.inventories?.arrival_date ? new Date(roll.inventories.arrival_date).toLocaleDateString('zh-TW') : null}
          </DetailField>
          <DetailField label="倉庫">{roll.warehouses?.name}</DetailField>
          <DetailField label="貨架">{roll.shelf}</DetailField>
          <DetailField label="品質">{qualityLabel(roll.quality)}</DetailField>
          <DetailField label="已出貨">{`${shipped.toFixed(2)} 公斤`}</DetailField>
          <DetailField label="入庫重量">{`${roll.quantity.toFixed(2)} 公斤`}</DetailField>
          <DetailField label="當前重量">{`${roll.current_quantity.toFixed(2)} 公斤`}</DetailField>
        </DetailSection>
      )}
    </RecordDialog>
  );
};
