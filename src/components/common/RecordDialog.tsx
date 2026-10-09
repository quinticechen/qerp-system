import React from 'react';
import { Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import type { RecordCreation } from '@/hooks/useRecordAuditLogs';
import { RecordAuditHistoryButton } from './RecordAuditHistoryButton';

export type RecordDialogMode = 'view' | 'edit' | 'create';

const SIZE_CLASSES = {
  md: 'sm:max-w-lg',
  lg: 'sm:max-w-3xl',
  xl: 'sm:max-w-5xl',
  '2xl': 'sm:max-w-6xl',
} as const;

interface RecordDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: RecordDialogMode;
  title: React.ReactNode;
  description?: React.ReactNode;
  size?: keyof typeof SIZE_CLASSES;
  // View mode: the 編輯紀錄 button next to the close button
  history?: { recordId: string; creation?: RecordCreation };
  // View mode: the 編輯 button; leave it out when the member may not edit or the record is frozen
  onEdit?: () => void;
  // Edit mode: 取消 goes back to the view and discards changes; closing the dialog does the same
  onCancelEdit?: () => void;
  // Edit and create modes: 更新 / 建立 calls onSubmit, or submits the <form id={formId}> in the body
  onSubmit?: () => void;
  formId?: string;
  submitting?: boolean;
  submitDisabled?: boolean;
  submitLabel?: string;
  // Edit mode, bottom left: 作廢 (cancel the document) or 停用／啟用
  editActions?: React.ReactNode;
  // Shown above the footer, e.g. the error from the last save
  error?: string | null;
  children: React.ReactNode;
}

// The one layout for every record (docs/requirements/UI_CONSISTENCY.md):
// view   — top right 編輯紀錄 + 關閉, bottom right 編輯
// edit   — top right 關閉, bottom right 取消 + 更新, bottom left 作廢 or 停用／啟用
// create — top right 關閉, bottom right 取消 + 建立
// The body scrolls inside the dialog, so tall records never run past the screen.
export const RecordDialog = ({
  open,
  onOpenChange,
  mode,
  title,
  description,
  size = 'md',
  history,
  onEdit,
  onCancelEdit,
  onSubmit,
  formId,
  submitting = false,
  submitDisabled = false,
  submitLabel,
  editActions,
  error,
  children,
}: RecordDialogProps) => {
  const handleOpenChange = (next: boolean) => {
    if (!next && mode === 'edit') onCancelEdit?.();
    onOpenChange(next);
  };

  const label = submitLabel ?? (mode === 'create' ? '建立' : '更新');

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className={cn('flex max-h-[90vh] flex-col gap-4', SIZE_CLASSES[size])}>
        <DialogHeader className="pr-16">
          {mode === 'view' && history && (
            <RecordAuditHistoryButton recordId={history.recordId} creation={history.creation} className="absolute right-10 top-2" />
          )}
          <DialogTitle className="text-gray-900">{title}</DialogTitle>
          {description && <DialogDescription className="text-gray-600">{description}</DialogDescription>}
        </DialogHeader>

        <div className="-mx-6 min-h-0 flex-1 space-y-6 overflow-y-auto px-6 pb-1">{children}</div>

        {error && (
          <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </p>
        )}

        {mode === 'view' ? (
          onEdit && (
            <div className="flex justify-end border-t pt-4">
              <Button size="icon" onClick={onEdit} aria-label="編輯" title="編輯">
                <Pencil className="h-4 w-4" />
              </Button>
            </div>
          )
        ) : (
          <div className="flex items-center gap-2 border-t pt-4">
            {mode === 'edit' && editActions}
            <div className="ml-auto flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => (mode === 'edit' ? onCancelEdit?.() : onOpenChange(false))}
                disabled={submitting}
              >
                取消
              </Button>
              <Button
                type={formId ? 'submit' : 'button'}
                form={formId}
                onClick={formId ? undefined : onSubmit}
                disabled={submitting || submitDisabled}
              >
                {submitting ? `${label}中...` : label}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
