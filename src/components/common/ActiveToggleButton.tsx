import React from 'react';
import { Power, PowerOff } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ActiveToggleButtonProps {
  isActive: boolean;
  // What is switched, e.g. 客戶 →「停用客戶」
  subject: string;
  onToggle: () => void;
  disabled?: boolean;
}

// The bottom-left edit action of master data (customers, factories, products, shelves, members)
export const ActiveToggleButton = ({ isActive, subject, onToggle, disabled = false }: ActiveToggleButtonProps) => {
  const label = `${isActive ? '停用' : '啟用'}${subject}`;
  return (
    <Button type="button" variant="outline" size="icon" onClick={onToggle} disabled={disabled} aria-label={label} title={label}>
      {isActive ? <PowerOff className="h-4 w-4" /> : <Power className="h-4 w-4" />}
    </Button>
  );
};
