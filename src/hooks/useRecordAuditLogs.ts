import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';

export interface RecordAuditEntry {
  id: string;
  table_name: string;
  record_id: string;
  parent_id: string | null;
  action: 'INSERT' | 'UPDATE' | 'DELETE';
  old_data: Record<string, Json> | null;
  new_data: Record<string, Json> | null;
  changed_fields: string[];
  changed_by: string | null;
  changed_at: string;
  editorName: string | null;
}

// Who created the document, from its own row; used when the log predates the document's creation
export interface RecordCreation {
  tableName: string;
  createdBy: string | null;
  createdAt: string;
}

export interface RecordAuditHistory {
  entries: RecordAuditEntry[];
  // Display names for ids found in the logged rows (products, warehouses, rolls, ...)
  referenceNames: Record<string, string>;
}

// Columns holding ids worth showing by name, and where to look the name up
type ReferenceTable = 'products_new' | 'warehouses' | 'factories' | 'customers' | 'inventory_rolls' | 'organization_roles' | 'profiles';

const ROLE_REFERENCE = { table: 'organization_roles', select: 'id, display_name' } as const;
const PERSON_REFERENCE = { table: 'profiles', select: 'id, full_name' } as const;

export const REFERENCE_FIELDS: Record<string, { table: ReferenceTable; select: string }> = {
  product_id: { table: 'products_new', select: 'id, name, color' },
  warehouse_id: { table: 'warehouses', select: 'id, name' },
  factory_id: { table: 'factories', select: 'id, name' },
  customer_id: { table: 'customers', select: 'id, name' },
  inventory_roll_id: { table: 'inventory_rolls', select: 'id, roll_number' },
  role_id: ROLE_REFERENCE,
  invited_role_id: ROLE_REFERENCE,
  user_id: PERSON_REFERENCE,
  owner_id: PERSON_REFERENCE,
  invited_by: PERSON_REFERENCE,
  granted_by: PERSON_REFERENCE,
};

interface NamedRow {
  id: string;
  name?: string;
  color?: string | null;
  roll_number?: string;
  display_name?: string;
  full_name?: string | null;
}

const displayName = (row: NamedRow) =>
  row.roll_number ??
  row.display_name ??
  row.full_name ??
  (row.color ? `${row.name} - ${row.color}` : row.name ?? row.id);

const resolveReferenceNames = async (rows: Omit<RecordAuditEntry, 'editorName'>[]) => {
  const idsByField = new Map<string, Set<string>>();
  rows.forEach((row) => {
    [row.old_data, row.new_data].forEach((data) => {
      Object.keys(REFERENCE_FIELDS).forEach((field) => {
        const value = data?.[field];
        if (typeof value === 'string') {
          if (!idsByField.has(field)) idsByField.set(field, new Set());
          idsByField.get(field)!.add(value);
        }
      });
    });
  });

  const names: Record<string, string> = {};
  await Promise.all(
    [...idsByField.entries()].map(async ([field, ids]) => {
      const { table, select } = REFERENCE_FIELDS[field];
      const { data, error } = await supabase.from(table).select(select).in('id', [...ids]);
      if (error) throw error;
      ((data ?? []) as unknown as NamedRow[]).forEach((row) => {
        names[row.id] = displayName(row);
      });
    }),
  );
  return names;
};

// Changes to a document itself plus every line item that belongs to it, newest first
export const useRecordAuditLogs = (recordId: string | null | undefined, creation?: RecordCreation) =>
  useQuery({
    queryKey: ['record-audit-logs', recordId, creation?.createdBy, creation?.createdAt],
    queryFn: async (): Promise<RecordAuditHistory> => {
      const { data: logs, error } = await supabase
        .from('record_audit_logs')
        .select('id, table_name, record_id, parent_id, action, old_data, new_data, changed_fields, changed_by, changed_at')
        .or(`record_id.eq.${recordId},parent_id.eq.${recordId}`)
        .order('changed_at', { ascending: false });
      if (error) throw error;

      const rows = (logs ?? []) as Omit<RecordAuditEntry, 'editorName'>[];

      // Documents created before the log existed have no INSERT row; show their creator from the document itself
      const hasCreation = rows.some((row) => row.record_id === recordId && row.action === 'INSERT');
      if (creation && !hasCreation) {
        rows.push({
          id: `created-${recordId}`,
          table_name: creation.tableName,
          record_id: recordId!,
          parent_id: null,
          action: 'INSERT',
          old_data: null,
          new_data: null,
          changed_fields: [],
          changed_by: creation.createdBy,
          changed_at: creation.createdAt,
        });
      }
      const editorIds = [...new Set(rows.map((row) => row.changed_by).filter((id): id is string => !!id))];

      const editors = new Map<string, string | null>();
      if (editorIds.length > 0) {
        const { data: profiles, error: profileError } = await supabase
          .from('profiles')
          .select('id, full_name')
          .in('id', editorIds);
        if (profileError) throw profileError;
        profiles?.forEach((profile) => editors.set(profile.id, profile.full_name));
      }

      const referenceNames = await resolveReferenceNames(rows);

      const entries = rows
        .map((row) => ({ ...row, editorName: row.changed_by ? editors.get(row.changed_by) ?? null : null }))
        .sort((a, b) => b.changed_at.localeCompare(a.changed_at));

      return { entries, referenceNames };
    },
    enabled: !!recordId,
  });
