import React, { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { useCreateShelf, type Shelf } from '@/hooks/useShelves';

interface CreateShelfDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existingShelves: Shelf[];
}

export const CreateShelfDialog: React.FC<CreateShelfDialogProps> = ({ open, onOpenChange, existingShelves }) => {
  const { toast } = useToast();
  const createShelf = useCreateShelf();
  const [name, setName] = useState('');

  useEffect(() => {
    if (!open) setName('');
  }, [open]);

  const trimmedName = name.trim();
  const isDuplicate = existingShelves.some((shelf) => shelf.name === trimmedName);

  const handleCreate = () => {
    if (!trimmedName || isDuplicate) return;
    createShelf.mutate(trimmedName, {
      onSuccess: () => {
        toast({ title: '已新增貨架', description: `貨架「${trimmedName}」已建立` });
        onOpenChange(false);
      },
      onError: (error: Error) => {
        toast({ title: '新增失敗', description: error.message, variant: 'destructive' });
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-gray-900">新增貨架</DialogTitle>
          <DialogDescription className="text-gray-700">
            新增後即可在「新增入庫」選擇此貨架存放布卷
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="new-shelf-name" className="text-gray-800">貨架名稱 *</Label>
          <Input
            id="new-shelf-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreate();
            }}
            placeholder="例如：1A 上"
            className="border-gray-300 text-gray-900"
            autoFocus
          />
          {isDuplicate && <p className="text-sm text-red-600">已有相同名稱的貨架</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="text-gray-700 border-gray-300">
            取消
          </Button>
          <Button
            onClick={handleCreate}
            disabled={!trimmedName || isDuplicate || createShelf.isPending}
            className="bg-blue-600 text-white hover:bg-blue-700"
          >
            {createShelf.isPending ? '新增中...' : '新增'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
