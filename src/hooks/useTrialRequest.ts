import { useMutation } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export const COMPANY_SIZES = ['1-10', '11-50', '51-200', '201+'] as const;
export type CompanySize = (typeof COMPANY_SIZES)[number];

export interface TrialRequestInput {
  contactName: string;
  phone: string;
  companyName: string;
  email?: string;
  companySize?: CompanySize;
  note?: string;
}

/** Raised by the database rate limit (private.trial_requests_throttle). */
const THROTTLED_MESSAGE = '申請太頻繁，請稍後再試';

/** Error shown to the visitor when a request can't be saved. */
export class TrialRequestError extends Error {}

const emptyToNull = (value: string | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

export const submitTrialRequest = async (input: TrialRequestInput): Promise<void> => {
  // No .select(): clients may insert requests but never read them back.
  const { error } = await supabase.from('trial_requests').insert({
    contact_name: input.contactName.trim(),
    phone: input.phone.trim(),
    company_name: input.companyName.trim(),
    email: emptyToNull(input.email),
    company_size: input.companySize ?? null,
    note: emptyToNull(input.note),
  });
  if (!error) return;
  if (error.code === 'PT429' || error.message === THROTTLED_MESSAGE) throw new TrialRequestError(THROTTLED_MESSAGE);
  throw new TrialRequestError('送出失敗，請稍後再試');
};

/** Saves a free-trial request from the public Home page (table trial_requests, insert-only). */
export const useTrialRequest = () => useMutation({ mutationFn: submitTrialRequest });
