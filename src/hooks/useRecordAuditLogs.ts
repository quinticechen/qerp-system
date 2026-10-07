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

// Changes to a document itself plus every line item that belongs to it, newest first
export const useRecordAuditLogs = (recordId: string | null | undefined) =>
  useQuery({
    queryKey: ['record-audit-logs', recordId],
    queryFn: async (): Promise<RecordAuditEntry[]> => {
      const { data: logs, error } = await supabase
        .from('record_audit_logs')
        .select('id, table_name, record_id, parent_id, action, old_data, new_data, changed_fields, changed_by, changed_at')
        .or(`record_id.eq.${recordId},parent_id.eq.${recordId}`)
        .order('changed_at', { ascending: false });
      if (error) throw error;

      const rows = (logs ?? []) as Omit<RecordAuditEntry, 'editorName'>[];
      const editorIds = [...new Set(rows.map((row) => row.changed_by).filter((id): id is string => !!id))];

      const names = new Map<string, string | null>();
      if (editorIds.length > 0) {
        const { data: profiles, error: profileError } = await supabase
          .from('profiles')
          .select('id, full_name')
          .in('id', editorIds);
        if (profileError) throw profileError;
        profiles?.forEach((profile) => names.set(profile.id, profile.full_name));
      }

      return rows
        .map((row) => ({ ...row, editorName: row.changed_by ? names.get(row.changed_by) ?? null : null }))
        .sort((a, b) => b.changed_at.localeCompare(a.changed_at));
    },
    enabled: !!recordId,
  });
