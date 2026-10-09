
import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Pencil, Power, PowerOff } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { RecordAuditHistoryButton } from '@/components/common/RecordAuditHistoryButton';

interface ViewCustomerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customer: any;
  onEdit?: () => void;
  // Disable or re-enable; shown only to members who may edit
  onToggleActive?: () => void;
}

export const ViewCustomerDialog: React.FC<ViewCustomerDialogProps> = ({
  open,
  onOpenChange,
  customer,
  onEdit,
  onToggleActive,
}) => {
  if (!customer) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <RecordAuditHistoryButton recordId={customer.id} className="absolute right-10 top-2" />
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
              <Label>手機</Label>
              <div className="p-2 bg-gray-50 rounded">{customer.phone}</div>
            </div>
          )}

          {customer.landline_phone && (
            <div className="space-y-2">
              <Label>市話</Label>
              <div className="p-2 bg-gray-50 rounded">{customer.landline_phone}</div>
            </div>
          )}

          {customer.fax && (
            <div className="space-y-2">
              <Label>傳真</Label>
              <div className="p-2 bg-gray-50 rounded">{customer.fax}</div>
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

          {customer.note && (
            <div className="space-y-2">
              <Label>備註</Label>
              <div className="p-2 bg-gray-50 rounded">{customer.note}</div>
            </div>
          )}

          <div className="space-y-2">
            <Label>建立時間</Label>
            <div className="p-2 bg-gray-50 rounded">
              {new Date(customer.created_at).toLocaleDateString('zh-TW')}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            關閉
          </Button>
          {onToggleActive && (
            <Button
              variant="outline"
              size="icon"
              onClick={onToggleActive}
              aria-label={customer.is_active ? '停用' : '啟用'}
              title={customer.is_active ? '停用' : '啟用'}
            >
              {customer.is_active ? <PowerOff className="h-4 w-4" /> : <Power className="h-4 w-4" />}
            </Button>
          )}
          {onEdit && (
            <Button size="icon" onClick={onEdit} aria-label="編輯" title="編輯">
              <Pencil className="h-4 w-4" />
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
