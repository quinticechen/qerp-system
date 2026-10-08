import type { OrganizationRole } from '@/lib/roles';

// A row of the user management list: the person's profile plus their membership in the current organization
export interface OrganizationMember {
  id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  // Owners show as 'owner'; everyone else has the role stored on their membership
  role: OrganizationRole;
  is_active: boolean;
  is_owner: boolean;
  is_pending: boolean;
  is_expired: boolean;
  invited_at?: string;
  created_at: string;
  updated_at?: string;
  joined_at: string | null;
  email_confirmed: boolean;
}
