import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { TrialRequestForm } from './TrialRequestForm';
import { TrialRequestThanks } from './TrialRequestThanks';

interface TrialRequestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** 免費試用: request form first, then the thank-you message in the same dialog. */
export function TrialRequestDialog({ open, onOpenChange }: TrialRequestDialogProps) {
  const [submitted, setSubmitted] = useState(false);

  const handleOpenChange = (next: boolean) => {
    onOpenChange(next);
    if (!next) setSubmitted(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        {submitted ? (
          <>
            <DialogHeader className="sr-only">
              <DialogTitle>已收到您的試用申請</DialogTitle>
              <DialogDescription>我們會盡快致電給您並開通帳號</DialogDescription>
            </DialogHeader>
            <TrialRequestThanks onClose={() => handleOpenChange(false)} />
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="text-xl">免費試用 QERP</DialogTitle>
              <DialogDescription>留下聯絡方式，我們會致電了解您的需求，並為您開通試用帳號。</DialogDescription>
            </DialogHeader>
            <TrialRequestForm onSubmitted={() => setSubmitted(true)} />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
