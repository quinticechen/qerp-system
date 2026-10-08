import type { PostgrestError } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import type { Database, Json } from '@/integrations/supabase/types';

// Shared plumbing for the business APIs (docs/BUSINESS_API.md §2): every write API returns the same
// result shape and raises errors as a Chinese message plus a stable code in the hint.

export interface ApiSummaryField {
  label: string;
  value: string;
}

export interface ApiResult {
  dry_run: boolean;
  id: string | null;
  // Display number of documents (order, purchase order, shipping); null for master data
  number: string | null;
  summary: {
    title: string;
    fields: ApiSummaryField[];
  };
}

export class ApiError extends Error {
  // SQLSTATE class, e.g. 42501 (forbidden), P0002 (not found), 22023 (invalid input)
  readonly code: string;
  // Stable code such as customer_name_taken; null for errors that did not come from a business API
  readonly hint: string | null;

  constructor(error: PostgrestError) {
    super(error.message);
    this.name = 'ApiError';
    this.code = error.code;
    this.hint = error.hint || null;
  }
}

export type ApiFunction = keyof Database['public']['Functions'];
export type ApiArgs<F extends ApiFunction> = Database['public']['Functions'][F]['Args'];

// Call a write API and return its result, throwing ApiError with the message to show the user
export const callApi = async <F extends ApiFunction>(fn: F, args: ApiArgs<F>): Promise<ApiResult> => {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new ApiError(error);
  return data as unknown as ApiResult;
};

// The message to show for a failed call; business-API messages are already written for users
export const apiErrorMessage = (error: unknown, fallback = '操作失敗，請稍後再試'): string =>
  error instanceof ApiError || error instanceof Error ? error.message || fallback : fallback;

export type ApiChanges = Record<string, Json>;
