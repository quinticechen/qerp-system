import React, { useState } from 'react';
import { History } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import type { RecordCreation } from '@/hooks/useRecordAuditLogs';
import { RecordAuditHistory } from './RecordAuditHistory';

interface RecordAuditHistoryButtonProps {
  recordId: string | null | undefined;
  creation?: RecordCreation;
  className?: string;
}

// Icon-only trigger; dialogs place it next to their close button (absolute right-10 top-2)
export const RecordAuditHistoryButton = ({ recordId, creation, className }: RecordAuditHistoryButtonProps) => {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="編輯紀錄"
        title="編輯紀錄"
        className={cn('h-8 w-8 text-gray-500 hover:text-gray-900', className)}
        onClick={() => setOpen(true)}
      >
        <History className="h-4 w-4" />
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>編輯紀錄</SheetTitle>
            <SheetDescription>此資料與相關項目的新增、修改、刪除紀錄</SheetDescription>
          </SheetHeader>
          <div className="mt-4">{open && <RecordAuditHistory recordId={recordId} creation={creation} />}</div>
        </SheetContent>
      </Sheet>
    </>
  );
};
