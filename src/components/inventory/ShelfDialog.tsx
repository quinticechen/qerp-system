import React, { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { apiErrorMessage } from '@/lib/api/client';
import { useSetShelfActive, useShelfProducts, useUpdateShelf, type Shelf } from '@/hooks/useShelves';
import { RecordDialog } from '@/components/common/RecordDialog';
import { DetailSection } from '@/components/common/DetailSection';
import { DetailField } from '@/components/common/DetailField';
import { FormField } from '@/components/common/FormField';
import { ActiveToggleButton } from '@/components/common/ActiveToggleButton';

interface ShelfDialogProps {
  // Pass the row from the latest list data so the view shows saved changes
  shelf: Shelf | null;
  onOpenChange: (open: boolean) => void;
  canEdit: boolean;
  // Names already in use, to warn before saving
  existingShelves: Shelf[];
}

const QUALITY_LABELS: Record<string, string> = {
  A: 'A級',
  B: 'B級',
  C: 'C級',
  D: 'D級',
  defective: '瑕疵品',
};

// A shelf: its name, location and what it holds; a disabled shelf keeps its rolls but cannot receive new ones
export const ShelfDialog: React.FC<ShelfDialogProps> = ({ shelf, onOpenChange, canEdit, existingShelves }) => {
  const { toast } = useToast();
  const { data: products, isLoading, error } = useShelfProducts(shelf?.id ?? null);
  const updateShelf = useUpdateShelf();
  const setShelfActive = useSetShelfActive();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    setEditing(false);
  }, [shelf?.id]);

  if (!shelf) return null;

  const trimmedName = name.trim();
  const isDuplicate = existingShelves.some((other) => other.id !== shelf.id && other.name === trimmedName);
  const totalRolls = products?.reduce((sum, p) => sum + p.rollCount, 0) ?? 0;
  const totalQuantity = products?.reduce((sum, p) => sum + p.totalQuantity, 0) ?? 0;

  const startEditing = () => {
    setName(shelf.name);
    setLocation(shelf.location ?? '');
    setSaveError(null);
    setEditing(true);
  };

  const handleSave = () => {
    const changes = {
      ...(trimmedName !== shelf.name ? { name: trimmedName } : {}),
      ...(location.trim() !== (shelf.location ?? '') ? { location: location.trim() } : {}),
    };
    if (Object.keys(changes).length === 0) {
      setEditing(false);
      return;
    }
    updateShelf.mutate(
      { id: shelf.id, changes },
      {
        onSuccess: () => {
          toast({ title: '已更新貨架', description: '入庫記錄與新增入庫的倉庫選項會同步顯示新名稱' });
          setEditing(false);
        },
        onError: (mutationError: Error) => setSaveError(apiErrorMessage(mutationError)),
      },
    );
  };

  const handleToggleActive = () =>
    setShelfActive.mutate(
      { id: shelf.id, isActive: !shelf.isActive },
      {
        onSuccess: () => {
          toast({
            title: shelf.isActive ? '已停用貨架' : '已啟用貨架',
            description: shelf.isActive ? `「${shelf.name}」不能再放入新的布卷，現有布卷不受影響` : `「${shelf.name}」可以放入布卷`,
          });
          setEditing(false);
        },
        onError: (mutationError: Error) => setSaveError(apiErrorMessage(mutationError)),
      },
    );

  return (
    <RecordDialog
      open
      onOpenChange={onOpenChange}
      mode={editing ? 'edit' : 'view'}
      title={editing ? '編輯貨架' : `貨架：${shelf.name}`}
      description={editing ? undefined : '此貨架目前存放的產品與數量（僅計算尚有庫存的布卷）'}
      size="lg"
      history={{ recordId: shelf.id }}
      onEdit={canEdit ? startEditing : undefined}
      onCancelEdit={() => setEditing(false)}
      onSubmit={handleSave}
      submitting={updateShelf.isPending}
      submitDisabled={!trimmedName || isDuplicate}
      error={saveError}
      editActions={
        <ActiveToggleButton isActive={shelf.isActive} subject="貨架" onToggle={handleToggleActive} disabled={setShelfActive.isPending} />
      }
    >
      {editing ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="貨架名稱" htmlFor="shelf-name" required error={isDuplicate ? '已有相同名稱的貨架' : undefined}>
            <Input id="shelf-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：1A 上" />
          </FormField>
          <FormField label="位置" htmlFor="shelf-location">
            <Input id="shelf-location" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="例如：一樓" />
          </FormField>
        </div>
      ) : (
        <>
          <DetailSection fields>
            <DetailField label="貨架名稱">{shelf.name}</DetailField>
            <DetailField label="位置">{shelf.location}</DetailField>
            <DetailField label="狀態">
              <Badge
                variant="outline"
                className={shelf.isActive ? 'border-green-200 bg-green-100 text-green-800' : 'border-gray-300 bg-gray-100 text-gray-600'}
              >
                {shelf.isActive ? '啟用' : '停用'}
              </Badge>
            </DetailField>
          </DetailSection>

          <DetailSection title="存放產品">
            {isLoading ? (
              <p className="py-8 text-center text-gray-500">載入中...</p>
            ) : error ? (
              <p className="py-8 text-center text-red-600">載入失敗：{(error as Error).message}</p>
            ) : !products || products.length === 0 ? (
              <p className="py-8 text-center text-gray-500">此貨架目前沒有存放任何產品</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>產品</TableHead>
                    <TableHead>顏色</TableHead>
                    <TableHead>品級</TableHead>
                    <TableHead className="text-right">卷數</TableHead>
                    <TableHead className="text-right">數量 (kg)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {products.map((product) => (
                    <TableRow key={product.productId}>
                      <TableCell className="font-medium text-gray-900">{product.productName}</TableCell>
                      <TableCell className="text-gray-700">
                        {product.color || '-'}
                        {product.colorCode && <span className="ml-1 text-xs text-gray-500">({product.colorCode})</span>}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {product.qualities.map((quality) => (
                            <Badge key={quality} variant="outline">
                              {QUALITY_LABELS[quality] ?? quality}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">{product.rollCount}</TableCell>
                      <TableCell className="text-right">{product.totalQuantity.toFixed(2)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell colSpan={3}>合計</TableCell>
                    <TableCell className="text-right">{totalRolls}</TableCell>
                    <TableCell className="text-right">{totalQuantity.toFixed(2)}</TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            )}
          </DetailSection>
        </>
      )}
    </RecordDialog>
  );
};
