import React from 'react';
import { CreateEntityDialog } from './CreateEntityDialog';

interface CreateCustomerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCustomerCreated: () => void;
}

export const CreateCustomerDialog: React.FC<CreateCustomerDialogProps> = ({ open, onOpenChange, onCustomerCreated }) => (
  <CreateEntityDialog open={open} onOpenChange={onOpenChange} onEntityCreated={onCustomerCreated} entityType="customer" />
);
