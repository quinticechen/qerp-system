import React, { useState } from 'react';
import { Ban } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface CancelRecordButtonProps {
  // e.g.「取消訂單」; also the button's aria-label
  label: string;
  // e.g. the document number, shown in the confirmation title
  subject: string;
  description: string;
  pending?: boolean;
  // Called with the optional reason; the confirmation closes when it settles
  onConfirm: (reason: string) => Promise<unknown>;
}

// The bottom-left edit action of documents (orders, purchase orders, shippings): cancel with a reason
export const CancelRecordButton = ({ label, subject, description, pending = false, onConfirm }: CancelRecordButtonProps) => {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');

  const confirm = async () => {
    try {
      await onConfirm(reason);
    } finally {
      setOpen(false);
      setReason('');
    }
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="border-red-300 text-red-700 hover:bg-red-50"
        onClick={() => setOpen(true)}
        disabled={pending}
        aria-label={label}
        title={label}
      >
        <Ban className="h-4 w-4" />
      </Button>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{`${label} ${subject}？`}</AlertDialogTitle>
            <AlertDialogDescription>{description}</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="cancel-record-reason">取消原因</Label>
            <Textarea id="cancel-record-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="選填" />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>返回</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={(e) => {
                e.preventDefault();
                void confirm();
              }}
              disabled={pending}
            >
              {pending ? '取消中...' : '確認取消'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
