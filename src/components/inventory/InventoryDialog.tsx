import React, { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { supabase } from '@/integrations/supabase/client';
import { apiErrorMessage } from '@/lib/api/client';
import { useToast } from '@/hooks/use-toast';
import {
  EditableInventoryRoll,
  InventoryRollRow,
  toEditableInventoryRoll,
  useSaveInventoryBatch,
  useWarehouseOptions,
} from '@/hooks/useInventoryEditing';
import { useProductOptions } from '@/hooks/useProductOptions';
import { RecordDialog } from '@/components/common/RecordDialog';
import { DetailSection } from '@/components/common/DetailSection';
import { DetailField } from '@/components/common/DetailField';
import { FormField } from '@/components/common/FormField';
import { InventoryRollsEditor } from './InventoryRollsEditor';

// The receiving batch fields the dialog shows; the list row has more
export interface InventoryRecord {
  id: string;
  organization_id: string | null;
  arrival_date: string;
  note: string | null;
  receipt_number?: string | null;
  created_at?: string;
  user_id?: string | null;
  factories?: { name: string } | null;
  purchase_orders?: { po_number: string } | null;
}

interface InventoryDialogProps {
  // Pass the row from the latest list data so the view shows saved changes
  inventory: InventoryRecord;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canEdit: boolean;
}

const QUALITY_BADGES: Record<string, { label: string; className: string }> = {
  A: { label: 'A級', className: 'bg-green-100 text-green-800' },
  B: { label: 'B級', className: 'bg-blue-100 text-blue-800' },
  C: { label: 'C級', className: 'bg-yellow-100 text-yellow-800' },
  D: { label: 'D級', className: 'bg-red-100 text-red-800' },
  defective: { label: '瑕疵', className: 'bg-gray-100 text-gray-800' },
};

// A receiving batch: its date, note and every roll; the factory follows the purchase order
export const InventoryDialog = ({ inventory, open, onOpenChange, canEdit }: InventoryDialogProps) => {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [arrivalDate, setArrivalDate] = useState('');
  const [note, setNote] = useState('');
  const [rolls, setRolls] = useState<EditableInventoryRoll[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const saveBatch = useSaveInventoryBatch();
  const { data: products = [] } = useProductOptions(editing ? inventory.organization_id : null);
  const { data: warehouses = [] } = useWarehouseOptions(editing ? inventory.organization_id : null);

  const { data: inventoryRolls, isLoading } = useQuery({
    queryKey: ['inventoryRolls', inventory.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inventory_rolls')
        .select(`
          *,
          products_new:product_id (id, name, color),
          warehouses:warehouse_id (id, name)
        `)
        .eq('inventory_id', inventory.id);
      if (error) throw error;
      return data;
    },
    enabled: open,
  });

  useEffect(() => {
    if (open) setEditing(false);
  }, [open, inventory.id]);

  const startEditing = () => {
    setArrivalDate((inventory.arrival_date ?? '').slice(0, 10));
    setNote(inventory.note ?? '');
    setRolls((inventoryRolls ?? []).map((roll) => toEditableInventoryRoll(roll as InventoryRollRow)));
    setSaveError(null);
    setEditing(true);
  };

  const cancelEditing = () => {
    setSaveError(null);
    setEditing(false);
  };

  const validate = (): string | null => {
    if (!arrivalDate) return '請填寫到貨日期';
    if (rolls.length === 0) return '入庫紀錄至少需要一卷布';
    if (rolls.some((roll) => !roll.product_id || !roll.warehouse_id)) return '請為每一卷選擇產品與倉庫';
    if (rolls.some((roll) => !(Number(roll.quantity) > 0))) return '請填寫正確的入庫重量';
    if (rolls.some((roll) => !roll.id && !roll.roll_number.trim())) return '新增的布卷需要布卷編號';
    return null;
  };

  const handleSubmit = () => {
    const problem = validate();
    setSaveError(problem);
    if (problem || !inventory.organization_id) return;
    saveBatch.mutate(
      { organizationId: inventory.organization_id, inventoryId: inventory.id, edits: { arrival_date: arrivalDate, note, rolls } },
      {
        onSuccess: () => {
          toast({ title: '已更新入庫紀錄' });
          setEditing(false);
        },
        onError: (error: Error) => setSaveError(apiErrorMessage(error)),
      },
    );
  };

  const totalQuantity = inventoryRolls?.reduce((total, roll) => total + roll.quantity, 0) || 0;
  const totalCurrentQuantity = inventoryRolls?.reduce((total, roll) => total + roll.current_quantity, 0) || 0;
  const totalRolls = inventoryRolls?.length || 0;

  return (
    <RecordDialog
      open={open}
      onOpenChange={onOpenChange}
      mode={editing ? 'edit' : 'view'}
      title={editing ? '編輯入庫紀錄' : '入庫紀錄詳情'}
      description={inventory.receipt_number ? `進貨單號：${inventory.receipt_number}` : undefined}
      size="2xl"
      history={{
        recordId: inventory.id,
        creation: { tableName: 'inventories', createdBy: inventory.user_id ?? null, createdAt: inventory.created_at },
      }}
      onEdit={canEdit ? startEditing : undefined}
      onCancelEdit={cancelEditing}
      onSubmit={handleSubmit}
      submitting={saveBatch.isPending}
      error={saveError}
    >
      {editing ? (
        <>
          <DetailSection title="基本資訊">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <DetailField label="採購單編號">{inventory.purchase_orders?.po_number}</DetailField>
              <DetailField label="工廠">{inventory.factories?.name}</DetailField>
              <FormField label="到貨日期" htmlFor="inventory-arrival-date" required>
                <Input id="inventory-arrival-date" type="date" value={arrivalDate} onChange={(e) => setArrivalDate(e.target.value)} />
              </FormField>
              <FormField label="備註" htmlFor="inventory-note" wide>
                <Textarea id="inventory-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
              </FormField>
            </div>
          </DetailSection>

          <DetailSection title="布卷明細">
            <InventoryRollsEditor rolls={rolls} onChange={setRolls} products={products} warehouses={warehouses} />
          </DetailSection>
        </>
      ) : (
        <>
          <DetailSection title="基本資訊" fields>
            <DetailField label="採購單編號">{inventory.purchase_orders?.po_number}</DetailField>
            <DetailField label="工廠">{inventory.factories?.name}</DetailField>
            <DetailField label="到貨日期">{inventory.arrival_date ? new Date(inventory.arrival_date).toLocaleDateString('zh-TW') : null}</DetailField>
            <DetailField label="建立時間">{inventory.created_at ? new Date(inventory.created_at).toLocaleString('zh-TW') : null}</DetailField>
            <DetailField label="備註" wide>{inventory.note}</DetailField>
          </DetailSection>

          <DetailSection title="統計" fields>
            <DetailField label="總入庫數量">{`${totalQuantity.toFixed(2)} 公斤`}</DetailField>
            <DetailField label="當前庫存">{`${totalCurrentQuantity.toFixed(2)} 公斤`}</DetailField>
            <DetailField label="總卷數">{`${totalRolls} 卷`}</DetailField>
          </DetailSection>

          <DetailSection title="布卷明細">
            {isLoading ? (
              <div className="py-4 text-center text-gray-500">載入中...</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>布卷編號</TableHead>
                    <TableHead>產品</TableHead>
                    <TableHead>倉庫</TableHead>
                    <TableHead>貨架</TableHead>
                    <TableHead className="text-center">品質</TableHead>
                    <TableHead className="text-right">入庫重量</TableHead>
                    <TableHead className="text-right">當前重量</TableHead>
                    <TableHead className="text-center">狀態</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {inventoryRolls?.map((roll) => {
                    const quality = QUALITY_BADGES[roll.quality] ?? { label: roll.quality, className: 'bg-gray-100 text-gray-800' };
                    return (
                      <TableRow key={roll.id}>
                        <TableCell className="font-medium text-gray-900">{roll.roll_number}</TableCell>
                        <TableCell className="text-gray-900">
                          {roll.products_new?.name} {roll.products_new?.color && `- ${roll.products_new.color}`}
                        </TableCell>
                        <TableCell className="text-gray-700">{roll.warehouses?.name}</TableCell>
                        <TableCell className="text-gray-700">{roll.shelf || '-'}</TableCell>
                        <TableCell className="text-center">
                          <Badge className={`${quality.className} border-0`}>{quality.label}</Badge>
                        </TableCell>
                        <TableCell className="text-right text-gray-900">{roll.quantity.toFixed(2)}</TableCell>
                        <TableCell className="text-right text-gray-900">{roll.current_quantity.toFixed(2)}</TableCell>
                        <TableCell className="text-center">
                          {roll.is_allocated ? (
                            <Badge className="border-0 bg-orange-100 text-orange-800">已分配</Badge>
                          ) : roll.current_quantity > 0 ? (
                            <Badge className="border-0 bg-green-100 text-green-800">可用</Badge>
                          ) : (
                            <Badge className="border-0 bg-gray-100 text-gray-800">已用完</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </DetailSection>
        </>
      )}
    </RecordDialog>
  );
};
