import { PhoneCall } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface TrialRequestThanksProps {
  onClose: () => void;
}

/** Shown after a free-trial request is saved: the team calls back and opens the account. */
export function TrialRequestThanks({ onClose }: TrialRequestThanksProps) {
  return (
    <div className="flex flex-col items-center text-center py-4" role="status">
      <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-indigo-50 text-indigo-600">
        <PhoneCall className="h-8 w-8" />
      </div>
      <h3 className="text-xl font-semibold text-slate-900">已收到您的試用申請</h3>
      <p className="mt-3 text-slate-600 leading-relaxed">
        我們會盡快致電給您，並為您開通 QERP 帳號。
        <br />
        感謝您的耐心等候！
      </p>
      <Button variant="outline" className="mt-6" onClick={onClose}>
        關閉
      </Button>
    </div>
  );
}
