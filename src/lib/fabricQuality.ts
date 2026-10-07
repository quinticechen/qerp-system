import type { Database } from '@/integrations/supabase/types';

export type FabricQuality = Database['public']['Enums']['fabric_quality'];

export const QUALITY_OPTIONS: { value: FabricQuality; label: string }[] = [
  { value: 'A', label: 'A級' },
  { value: 'B', label: 'B級' },
  { value: 'C', label: 'C級' },
  { value: 'D', label: 'D級' },
  { value: 'defective', label: '瑕疵' },
];
