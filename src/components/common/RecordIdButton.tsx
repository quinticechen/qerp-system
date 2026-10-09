import React from 'react';
import { Fingerprint } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

interface RecordIdButtonProps {
  recordId: string;
}

// Shown in the top-right corner of an audit entry when the entry is hovered or focused; copies the record ID
export const RecordIdButton = ({ recordId }: RecordIdButtonProps) => {
  const label = `記錄 ID：${recordId}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(recordId);
      toast.success('已複製記錄 ID');
    } catch {
      toast.error('無法複製記錄 ID');
    }
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={label}
      title={label}
      onClick={copy}
      className="absolute right-2 top-2 h-7 w-7 text-gray-400 opacity-0 transition-opacity hover:text-gray-700 focus-visible:opacity-100 group-hover:opacity-100"
    >
      <Fingerprint className="h-4 w-4" />
    </Button>
  );
};
