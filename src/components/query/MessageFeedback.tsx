import { ThumbsDown, ThumbsUp } from 'lucide-react';
import { useQueryFeedback, type QueryFeedback } from '@/hooks/useQueryFeedback';

interface MessageFeedbackProps {
  messageId: string;
  feedback: QueryFeedback | null;
}

const OPTIONS = [
  { value: 'up', label: '回覆有幫助', Icon: ThumbsUp, active: 'text-indigo-600' },
  { value: 'down', label: '回覆沒有幫助', Icon: ThumbsDown, active: 'text-rose-600' },
] as const;

/** Thumbs up/down under a Query reply. */
export function MessageFeedback({ messageId, feedback }: MessageFeedbackProps) {
  const { feedback: current, rate, isSaving } = useQueryFeedback(messageId, feedback);

  return (
    <div className="mt-2 -mb-1 flex justify-end gap-0.5">
      {OPTIONS.map(({ value, label, Icon, active }) => {
        const selected = current === value;
        return (
          <button
            key={value}
            type="button"
            onClick={() => rate(value)}
            disabled={isSaving}
            aria-label={label}
            title={label}
            aria-pressed={selected}
            className={`p-1 rounded-md transition-colors hover:bg-gray-100 disabled:opacity-60 ${selected ? active : 'text-gray-400 hover:text-gray-600'}`}
          >
            <Icon className="w-3.5 h-3.5" fill={selected ? 'currentColor' : 'none'} />
          </button>
        );
      })}
    </div>
  );
}
