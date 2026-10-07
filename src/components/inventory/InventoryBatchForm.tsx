import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useFactoryOptions, useUpdateInventoryBatch } from '@/hooks/useInventoryEditing';

export interface EditableInventoryBatch {
  id: string;
  organization_id: string | null;
  arrival_date: string;
  factory_id: string;
  note: string | null;
}

interface InventoryBatchFormProps {
  inventory: EditableInventoryBatch;
  onDone: () => void;
}

export const InventoryBatchForm = ({ inventory, onDone }: InventoryBatchFormProps) => {
  const { toast } = useToast();
  const { data: factories } = useFactoryOptions(inventory.organization_id);
  const updateBatch = useUpdateInventoryBatch();
  const [arrivalDate, setArrivalDate] = useState(inventory.arrival_date.slice(0, 10));
  const [factoryId, setFactoryId] = useState(inventory.factory_id);
  const [note, setNote] = useState(inventory.note ?? '');

  const handleSave = () => {
    if (!arrivalDate) {
      toast({ title: '請填寫到貨日期', variant: 'destructive' });
      return;
    }
    updateBatch.mutate(
      { inventoryId: inventory.id, edits: { arrival_date: arrivalDate, factory_id: factoryId, note } },
      {
        onSuccess: () => {
          toast({ title: '已更新入庫資料' });
          onDone();
        },
        onError: (error: Error) => {
          toast({ title: '更新失敗', description: error.message, variant: 'destructive' });
        },
      },
    );
  };

  return (
    <div className="space-y-4 rounded-lg border border-blue-200 bg-blue-50/40 p-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="batch-arrival-date" className="text-gray-700">到貨日期</Label>
          <Input
            id="batch-arrival-date"
            type="date"
            value={arrivalDate}
            onChange={(e) => setArrivalDate(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="batch-factory" className="text-gray-700">工廠</Label>
          <Select value={factoryId} onValueChange={setFactoryId}>
            <SelectTrigger id="batch-factory">
              <SelectValue placeholder="選擇工廠" />
            </SelectTrigger>
            <SelectContent>
              {factories?.map((factory) => (
                <SelectItem key={factory.id} value={factory.id}>
                  {factory.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="batch-note" className="text-gray-700">備註</Label>
        <Textarea id="batch-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onDone} disabled={updateBatch.isPending}>
          取消
        </Button>
        <Button
          onClick={handleSave}
          disabled={updateBatch.isPending}
          className="bg-blue-600 text-white hover:bg-blue-700"
        >
          {updateBatch.isPending ? '儲存中...' : '儲存'}
        </Button>
      </div>
    </div>
  );
};
