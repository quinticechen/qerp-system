import React from 'react';
import { CreateEntityDialog } from './CreateEntityDialog';

interface CreateCustomerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCustomerCreated: () => void;
}

const customerFields = [
  { key: 'name', label: '客戶名稱', type: 'text' as const, required: true },
  { key: 'contact_person', label: '聯絡人', type: 'text' as const, required: true },
  { key: 'phone', label: '手機', type: 'text' as const, placeholder: '至少填寫手機或市話其中一個' },
  { key: 'landline_phone', label: '市話', type: 'text' as const, placeholder: '至少填寫手機或市話其中一個' },
  { key: 'fax', label: '傳真', type: 'text' as const },
  { key: 'email', label: 'Email', type: 'email' as const },
  { key: 'address', label: '地址', type: 'textarea' as const, rows: 3 },
  { key: 'note', label: '備註', type: 'textarea' as const, rows: 3 },
];

export const CreateCustomerDialog: React.FC<CreateCustomerDialogProps> = (props) => {
  return (
    <CreateEntityDialog
      {...props}
      onEntityCreated={props.onCustomerCreated}
      entityType="customer"
      title="新增客戶"
      tableName="customers"
      fields={customerFields}
    />
  );
};