import React from 'react';
import { History } from 'lucide-react';
import { RecordAuditEntry, useRecordAuditLogs } from '@/hooks/useRecordAuditLogs';
import {
  AUDIT_ACTION_LABELS,
  AUDIT_FIELD_LABELS,
  AUDIT_TABLE_LABELS,
  formatAuditValue,
} from '@/lib/auditLabels';

interface RecordAuditHistoryProps {
  recordId: string | null | undefined;
}

const ChangedFields = ({ entry }: { entry: RecordAuditEntry }) => {
  if (entry.action !== 'UPDATE' || entry.changed_fields.length === 0) return null;
  return (
    <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
      {entry.changed_fields.map((field) => (
        <React.Fragment key={field}>
          <dt className="text-gray-600">{AUDIT_FIELD_LABELS[field] ?? field}</dt>
          <dd className="break-all text-gray-900">
            {`${formatAuditValue(entry.old_data?.[field])} → ${formatAuditValue(entry.new_data?.[field])}`}
          </dd>
        </React.Fragment>
      ))}
    </dl>
  );
};

export const RecordAuditHistory = ({ recordId }: RecordAuditHistoryProps) => {
  const { data: entries, isLoading, error } = useRecordAuditLogs(recordId);

  return (
    <div className="space-y-3">
      <h3 className="flex items-center gap-2 text-lg font-semibold text-gray-900">
        <History className="h-5 w-5" />
        編輯紀錄
      </h3>

      {isLoading ? (
        <div className="py-4 text-center text-gray-500">載入中...</div>
      ) : error ? (
        <div className="py-4 text-center text-red-600">無法載入編輯紀錄</div>
      ) : !entries || entries.length === 0 ? (
        <div className="py-4 text-center text-gray-500">尚無編輯紀錄</div>
      ) : (
        <ul className="space-y-2">
          {entries.map((entry) => (
            <li key={entry.id} className="rounded-lg border border-gray-200 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="font-medium text-gray-900">
                  {`${AUDIT_ACTION_LABELS[entry.action] ?? entry.action}${AUDIT_TABLE_LABELS[entry.table_name] ?? entry.table_name}`}
                </span>
                <span className="text-gray-600">
                  <span>{entry.editorName ?? '系統'}</span>
                  <span className="mx-2">·</span>
                  <time dateTime={entry.changed_at}>{new Date(entry.changed_at).toLocaleString('zh-TW')}</time>
                </span>
              </div>
              <div className="mt-1 break-all text-xs text-gray-500">記錄 ID：{entry.record_id}</div>
              <ChangedFields entry={entry} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
