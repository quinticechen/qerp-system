import React, { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { useRenameShelf, type Shelf } from '@/hooks/useShelves';

interface RenameShelfDialogProps {
  shelf: Shelf | null;
  onOpenChange: (open: boolean) => void;
}

export const RenameShelfDialog: React.FC<RenameShelfDialogProps> = ({ shelf, onOpenChange }) => {
  const { toast } = useToast();
  const renameShelf = useRenameShelf();
  const [name, setName] = useState('');

  useEffect(() => {
    setName(shelf?.name ?? '');
  }, [shelf]);

  const trimmedName = name.trim();

  const handleSave = () => {
    if (!shelf || !trimmedName) return;
    renameShelf.mutate(
      { id: shelf.id, name: trimmedName },
      {
        onSuccess: () => {
          toast({ title: '已更新貨架名稱', description: `貨架已更名為「${trimmedName}」` });
          onOpenChange(false);
        },
        onError: (error: Error) => {
          toast({ title: '更新失敗', description: error.message, variant: 'destructive' });
        },
      }
    );
  };

  return (
    <Dialog open={!!shelf} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-gray-900">編輯貨架名稱</DialogTitle>
          <DialogDescription className="text-gray-700">
            更名後，入庫記錄與新增入庫的倉庫選項會同步顯示新名稱
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="shelf-name" className="text-gray-800">貨架名稱 *</Label>
          <Input
            id="shelf-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSave();
            }}
            placeholder="例如：1A 上"
            className="border-gray-300 text-gray-900"
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="text-gray-700 border-gray-300">
            取消
          </Button>
          <Button
            onClick={handleSave}
            disabled={!trimmedName || trimmedName === shelf?.name || renameShelf.isPending}
            className="bg-blue-600 text-white hover:bg-blue-700"
          >
            {renameShelf.isPending ? '儲存中...' : '儲存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
