import React from 'react';
import type { Json } from '@/integrations/supabase/types';
import { REFERENCE_FIELDS, RecordAuditEntry, RecordCreation, useRecordAuditLogs } from '@/hooks/useRecordAuditLogs';
import {
  AUDIT_ACTION_LABELS,
  AUDIT_FIELD_LABELS,
  AUDIT_SNAPSHOT_HIDDEN_FIELDS,
  AUDIT_TABLE_LABELS,
  formatAuditValue,
} from '@/lib/auditLabels';
import { PERMISSION_LABELS } from '@/lib/permissionLabels';

interface RecordAuditHistoryProps {
  recordId: string | null | undefined;
  creation?: RecordCreation;
}

type Names = Record<string, string>;

const formatFieldValue = (field: string, value: Json | undefined, names: Names) =>
  field in REFERENCE_FIELDS && typeof value === 'string' && names[value] ? names[value] : formatAuditValue(value);

type PermissionMap = Record<string, boolean>;

const asPermissions = (value: Json | undefined): PermissionMap =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as PermissionMap) : {};

// Role permissions are a map of switches; describe which ones were turned on or off
const describePermissions = (before: Json | undefined, after: Json | undefined) => {
  const old = asPermissions(before);
  const next = asPermissions(after);
  const keys = [...new Set([...Object.keys(old), ...Object.keys(next)])];
  const label = (key: string) => PERMISSION_LABELS[key] ?? key;
  const turnedOn = keys.filter((key) => next[key] === true && old[key] !== true).map(label);
  const turnedOff = keys.filter((key) => next[key] !== true && old[key] === true).map(label);
  return [
    turnedOn.length > 0 ? `開啟：${turnedOn.join('、')}` : null,
    turnedOff.length > 0 ? `關閉：${turnedOff.join('、')}` : null,
  ]
    .filter(Boolean)
    .join('｜') || '無變更';
};

// What the row is about, e.g. the product of an order line or the roll number of a roll
const subjectOf = (entry: RecordAuditEntry, names: Names): string | null => {
  const row = entry.action === 'DELETE' ? entry.old_data : entry.new_data;
  if (!row) return null;
  if (typeof row.roll_number === 'string') return row.roll_number;
  for (const field of ['product_id', 'inventory_roll_id', 'role_id']) {
    const value = row[field];
    if (typeof value === 'string' && names[value]) return names[value];
  }
  for (const field of ['name', 'display_name', 'full_name']) {
    if (typeof row[field] === 'string') return row[field] as string;
  }
  return null;
};

const FieldList = ({ rows }: { rows: { label: string; value: string }[] }) =>
  rows.length === 0 ? null : (
    <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
      {rows.map((row) => (
        <React.Fragment key={row.label}>
          <dt className="text-gray-600">{row.label}</dt>
          <dd className="break-all text-gray-900">{row.value}</dd>
        </React.Fragment>
      ))}
    </dl>
  );

const entryFields = (entry: RecordAuditEntry, names: Names) => {
  if (entry.action === 'UPDATE') {
    return entry.changed_fields.map((field) => ({
      label: AUDIT_FIELD_LABELS[field] ?? field,
      value:
        field === 'permissions'
          ? describePermissions(entry.old_data?.[field], entry.new_data?.[field])
          : `${formatFieldValue(field, entry.old_data?.[field], names)} → ${formatFieldValue(field, entry.new_data?.[field], names)}`,
    }));
  }

  // Added or removed rows: show the meaningful contents of the row
  const row = (entry.action === 'INSERT' ? entry.new_data : entry.old_data) ?? {};
  return Object.keys(AUDIT_FIELD_LABELS)
    .filter((field) => !AUDIT_SNAPSHOT_HIDDEN_FIELDS.has(field))
    .filter((field) => row[field] !== undefined && row[field] !== null && row[field] !== '')
    .map((field) => ({
      label: AUDIT_FIELD_LABELS[field],
      value: field === 'permissions' ? describePermissions(undefined, row[field]) : formatFieldValue(field, row[field], names),
    }));
};

export const RecordAuditHistory = ({ recordId, creation }: RecordAuditHistoryProps) => {
  const { data, isLoading, error } = useRecordAuditLogs(recordId, creation);

  if (isLoading) return <div className="py-4 text-center text-gray-500">載入中...</div>;
  if (error) return <div className="py-4 text-center text-red-600">無法載入編輯紀錄</div>;
  if (!data || data.entries.length === 0) return <div className="py-4 text-center text-gray-500">尚無編輯紀錄</div>;

  const names = data.referenceNames;

  return (
    <ul className="space-y-2">
      {data.entries.map((entry) => {
        const subject = subjectOf(entry, names);
        return (
          <li key={entry.id} className="rounded-lg border border-gray-200 p-3">
            <div className="font-medium text-gray-900">
              {`${AUDIT_ACTION_LABELS[entry.action] ?? entry.action}${AUDIT_TABLE_LABELS[entry.table_name] ?? entry.table_name}${subject ? `「${subject}」` : ''}`}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-gray-600">
              <span>{entry.editorName ?? '系統'}</span>
              <span>·</span>
              <time dateTime={entry.changed_at}>{new Date(entry.changed_at).toLocaleString('zh-TW')}</time>
            </div>
            <FieldList rows={entryFields(entry, names)} />
            <div className="mt-2 break-all text-xs text-gray-400">記錄 ID：{entry.record_id}</div>
          </li>
        );
      })}
    </ul>
  );
};
