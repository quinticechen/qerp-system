
import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface CreateProductDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const CreateProductDialog: React.FC<CreateProductDialogProps> = ({
  open,
  onOpenChange
}) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>新增產品</DialogTitle>
        </DialogHeader>
        <div className="text-center py-8 text-gray-500">
          新增產品功能開發中...
        </div>
      </DialogContent>
    </Dialog>
  );
};
