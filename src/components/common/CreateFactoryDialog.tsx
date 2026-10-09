import React from 'react';
import { CreateEntityDialog } from './CreateEntityDialog';

interface CreateFactoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onFactoryCreated: () => void;
}

export const CreateFactoryDialog: React.FC<CreateFactoryDialogProps> = ({ open, onOpenChange, onFactoryCreated }) => (
  <CreateEntityDialog open={open} onOpenChange={onOpenChange} onEntityCreated={onFactoryCreated} entityType="factory" />
);
