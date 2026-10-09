import React, { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { apiErrorMessage } from '@/lib/api/client';
import { useCreateShelf, type Shelf } from '@/hooks/useShelves';
import { RecordDialog } from '@/components/common/RecordDialog';
import { FormField } from '@/components/common/FormField';

interface CreateShelfDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existingShelves: Shelf[];
}

// The same fields as the shelf's edit mode
export const CreateShelfDialog: React.FC<CreateShelfDialogProps> = ({ open, onOpenChange, existingShelves }) => {
  const { toast } = useToast();
  const createShelf = useCreateShelf();
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');

  useEffect(() => {
    if (!open) {
      setName('');
      setLocation('');
    }
  }, [open]);

  const trimmedName = name.trim();
  const isDuplicate = existingShelves.some((shelf) => shelf.name === trimmedName);

  const handleCreate = () => {
    if (!trimmedName || isDuplicate) return;
    createShelf.mutate(
      { name: trimmedName, location: location.trim() || undefined },
      {
        onSuccess: () => {
          toast({ title: '已新增貨架', description: `貨架「${trimmedName}」已建立` });
          onOpenChange(false);
        },
        onError: (error: Error) => {
          toast({ title: '新增失敗', description: apiErrorMessage(error), variant: 'destructive' });
        },
      },
    );
  };

  return (
    <RecordDialog
      open={open}
      onOpenChange={onOpenChange}
      mode="create"
      title="新增貨架"
      description="新增後即可在「新增入庫」選擇此貨架存放布卷"
      onSubmit={handleCreate}
      submitting={createShelf.isPending}
      submitDisabled={!trimmedName || isDuplicate}
      submitLabel="新增"
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField label="貨架名稱" htmlFor="new-shelf-name" required error={isDuplicate ? '已有相同名稱的貨架' : undefined}>
          <Input
            id="new-shelf-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreate();
            }}
            placeholder="例如：1A 上"
            autoFocus
          />
        </FormField>
        <FormField label="位置" htmlFor="new-shelf-location">
          <Input id="new-shelf-location" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="例如：一樓" />
        </FormField>
      </div>
    </RecordDialog>
  );
};
