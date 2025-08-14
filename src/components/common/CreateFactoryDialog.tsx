import React from 'react';
import { CreateEntityDialog } from './CreateEntityDialog';

interface CreateFactoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onFactoryCreated: () => void;
}

const factoryFields = [
  { key: 'name', label: '工廠名稱', type: 'text' as const, required: true },
  { key: 'contact_person', label: '聯絡人', type: 'text' as const, required: true },
  { key: 'phone', label: '手機', type: 'text' as const, placeholder: '至少填寫手機或市話其中一個' },
  { key: 'landline_phone', label: '市話', type: 'text' as const, placeholder: '至少填寫手機或市話其中一個' },
  { key: 'fax', label: '傳真', type: 'text' as const },
  { key: 'email', label: 'Email', type: 'email' as const },
  { key: 'address', label: '地址', type: 'textarea' as const, rows: 3 },
  { key: 'note', label: '備註', type: 'textarea' as const, rows: 3 },
];

export const CreateFactoryDialog: React.FC<CreateFactoryDialogProps> = (props) => {
  return (
    <CreateEntityDialog
      {...props}
      onEntityCreated={props.onFactoryCreated}
      entityType="factory"
      title="新增工廠"
      tableName="factories"
      fields={factoryFields}
    />
  );
};