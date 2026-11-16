import { useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { TrialRequestDialog } from '@/components/home/TrialRequestDialog';
import { useOrganizationContext } from '@/contexts/OrganizationContext';
import { useOrganizationEntitlement } from '@/hooks/useOrganizationEntitlement';

/** Pages a not-yet-activated organization can still open (settings: plan, delete the organization). */
const OPEN_WHILE_PENDING = ['/system'];

/**
 * A new organization stays 'pending' until it pays or the team activates it
 * (docs/requirements/PRICING_AND_BILLING.md §3); until then the ERP pages show how to activate.
 */
export function OrganizationActivationGate({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const { currentOrganization } = useOrganizationContext();
  const { data: entitlement } = useOrganizationEntitlement(currentOrganization?.id);
  const [trialOpen, setTrialOpen] = useState(false);

  if (entitlement?.status !== 'pending' || OPEN_WHILE_PENDING.includes(pathname)) return <>{children}</>;

  return (
    <Card className="mx-auto mt-10 max-w-xl">
      <CardContent className="p-8 text-center">
        <Clock className="mx-auto h-12 w-12 text-indigo-500" aria-hidden="true" />
        <h2 className="mt-4 text-2xl font-bold text-slate-900">「{currentOrganization?.name}」尚未開通</h2>
        <p className="mt-3 leading-relaxed text-slate-600">
          選擇付費方案，付款完成後立即開通；或申請免費試用，我們會盡快致電為您開通。
          已經申請過免費試用的話，請稍候我們的電話。
        </p>
        <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
          <Button asChild className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white hover:from-blue-700 hover:to-indigo-700">
            <Link to="/pricing">查看方案與價格</Link>
          </Button>
          <Button variant="outline" onClick={() => setTrialOpen(true)}>申請免費試用</Button>
        </div>
      </CardContent>
      <TrialRequestDialog open={trialOpen} onOpenChange={setTrialOpen} />
    </Card>
  );
}
