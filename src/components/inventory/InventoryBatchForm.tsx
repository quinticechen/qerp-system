import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { useUpdateInventoryBatch } from '@/hooks/useInventoryEditing';
import { apiErrorMessage } from '@/lib/api/client';

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
  const updateBatch = useUpdateInventoryBatch();
  const [arrivalDate, setArrivalDate] = useState(inventory.arrival_date.slice(0, 10));
  const [note, setNote] = useState(inventory.note ?? '');

  const handleSave = () => {
    if (!arrivalDate) {
      toast({ title: '請填寫到貨日期', variant: 'destructive' });
      return;
    }
    if (!inventory.organization_id) return;
    // The factory follows the purchase order, so only the date and note are edited here
    updateBatch.mutate(
      { organizationId: inventory.organization_id, inventoryId: inventory.id, edits: { arrival_date: arrivalDate, note } },
      {
        onSuccess: () => {
          toast({ title: '已更新入庫資料' });
          onDone();
        },
        onError: (error: Error) => {
          toast({ title: '更新失敗', description: apiErrorMessage(error), variant: 'destructive' });
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
