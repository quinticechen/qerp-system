
import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

interface ViewCustomerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customer: any;
}

export const ViewCustomerDialog: React.FC<ViewCustomerDialogProps> = ({
  open,
  onOpenChange,
  customer,
}) => {
  if (!customer) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>客戶詳情</DialogTitle>
          <DialogDescription>
            查看客戶資訊
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>客戶名稱</Label>
            <div className="p-2 bg-gray-50 rounded">{customer.name}</div>
          </div>

          {customer.contact_person && (
            <div className="space-y-2">
              <Label>聯絡人</Label>
              <div className="p-2 bg-gray-50 rounded">{customer.contact_person}</div>
            </div>
          )}

          {customer.phone && (
            <div className="space-y-2">
              <Label>電話</Label>
              <div className="p-2 bg-gray-50 rounded">{customer.phone}</div>
            </div>
          )}

          {customer.email && (
            <div className="space-y-2">
              <Label>Email</Label>
              <div className="p-2 bg-gray-50 rounded">{customer.email}</div>
            </div>
          )}

          {customer.address && (
            <div className="space-y-2">
              <Label>地址</Label>
              <div className="p-2 bg-gray-50 rounded">{customer.address}</div>
            </div>
          )}

          <div className="space-y-2">
            <Label>建立時間</Label>
            <div className="p-2 bg-gray-50 rounded">
              {new Date(customer.created_at).toLocaleDateString('zh-TW')}
            </div>
          </div>
        </div>

        <div className="flex justify-end pt-4">
          <Button onClick={() => onOpenChange(false)}>
            關閉
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
