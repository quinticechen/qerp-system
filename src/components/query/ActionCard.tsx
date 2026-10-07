import { Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useQueryAction, type QueryActionStatus } from '@/hooks/useQueryAction';

interface ActionCardProps {
  actionId: string;
}

const STATUS_LABELS: Record<QueryActionStatus, string> = {
  pending: '待確認',
  executing: '處理中',
  confirmed: '已完成',
  cancelled: '已取消',
  expired: '已過期',
  failed: '失敗',
};

const STATUS_CLASSES: Record<QueryActionStatus, string> = {
  pending: 'bg-amber-100 text-amber-800 hover:bg-amber-100',
  executing: 'bg-indigo-100 text-indigo-700 hover:bg-indigo-100',
  confirmed: 'bg-emerald-100 text-emerald-700 hover:bg-emerald-100',
  cancelled: 'bg-gray-100 text-gray-500 hover:bg-gray-100',
  expired: 'bg-gray-100 text-gray-500 hover:bg-gray-100',
  failed: 'bg-red-100 text-red-700 hover:bg-red-100',
};

/** Confirmation card for a write the Query assistant drafted — nothing is saved until 確認. */
export function ActionCard({ actionId }: ActionCardProps) {
  const { action, isLoading, confirm, cancel, isDeciding } = useQueryAction(actionId);

  if (isLoading || !action) {
    return (
      <div className="flex items-center gap-2 text-xs text-gray-400">
        <Loader2 size={12} className="animate-spin" />
        載入操作內容…
      </div>
    );
  }

  // A draft past its deadline shows as expired even before the server marks it.
  const status: QueryActionStatus =
    action.status === 'pending' && action.expiresAt.getTime() <= Date.now() ? 'expired' : action.status;

  return (
    <div className="space-y-3" data-testid="query-action-card">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-gray-800">{action.summary.title}</p>
        <Badge className={STATUS_CLASSES[status]}>{STATUS_LABELS[status]}</Badge>
      </div>

      <dl className="space-y-1.5 text-sm">
        {action.summary.fields.map((field) => (
          <div key={field.label} className="grid grid-cols-[4.5rem_1fr] gap-2">
            <dt className="text-gray-500">{field.label}</dt>
            <dd className="text-gray-800 whitespace-pre-line break-words">{field.value}</dd>
          </div>
        ))}
      </dl>

      {status === 'failed' && action.error && <p className="text-xs text-red-600">{action.error}</p>}

      {status === 'pending' ? (
        <div className="flex gap-2 pt-1">
          <Button size="sm" onClick={confirm} disabled={isDeciding} className="bg-indigo-600 hover:bg-indigo-700">
            {isDeciding && <Loader2 size={14} className="mr-1 animate-spin" />}
            確認
          </Button>
          <Button size="sm" variant="outline" onClick={cancel} disabled={isDeciding}>
            取消
          </Button>
        </div>
      ) : (
        status === 'expired' && <p className="text-xs text-gray-500">草稿已過期，如仍需要請重新提出要求。</p>
      )}
    </div>
  );
}
