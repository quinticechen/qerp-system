
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
import { RecordAuditHistoryButton } from '@/components/common/RecordAuditHistoryButton';

interface ViewFactoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  factory: any;
  onEdit?: () => void;
}

export const ViewFactoryDialog: React.FC<ViewFactoryDialogProps> = ({
  open,
  onOpenChange,
  factory,
  onEdit,
}) => {
  if (!factory) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <RecordAuditHistoryButton recordId={factory.id} className="absolute right-10 top-2" />
          <DialogTitle>工廠詳情</DialogTitle>
          <DialogDescription>
            查看工廠資訊
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>工廠名稱</Label>
            <div className="p-2 bg-gray-50 rounded">{factory.name}</div>
          </div>

          {factory.contact_person && (
            <div className="space-y-2">
              <Label>聯絡人</Label>
              <div className="p-2 bg-gray-50 rounded">{factory.contact_person}</div>
            </div>
          )}

          {factory.phone && (
            <div className="space-y-2">
              <Label>手機</Label>
              <div className="p-2 bg-gray-50 rounded">{factory.phone}</div>
            </div>
          )}

          {factory.landline_phone && (
            <div className="space-y-2">
              <Label>市話</Label>
              <div className="p-2 bg-gray-50 rounded">{factory.landline_phone}</div>
            </div>
          )}

          {factory.fax && (
            <div className="space-y-2">
              <Label>傳真</Label>
              <div className="p-2 bg-gray-50 rounded">{factory.fax}</div>
            </div>
          )}

          {factory.email && (
            <div className="space-y-2">
              <Label>Email</Label>
              <div className="p-2 bg-gray-50 rounded">{factory.email}</div>
            </div>
          )}

          {factory.address && (
            <div className="space-y-2">
              <Label>地址</Label>
              <div className="p-2 bg-gray-50 rounded">{factory.address}</div>
            </div>
          )}

          {factory.note && (
            <div className="space-y-2">
              <Label>備註</Label>
              <div className="p-2 bg-gray-50 rounded">{factory.note}</div>
            </div>
          )}

          <div className="space-y-2">
            <Label>建立時間</Label>
            <div className="p-2 bg-gray-50 rounded">
              {new Date(factory.created_at).toLocaleDateString('zh-TW')}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            關閉
          </Button>
          {onEdit && <Button onClick={onEdit}>編輯</Button>}
        </div>
      </DialogContent>
    </Dialog>
  );
};
