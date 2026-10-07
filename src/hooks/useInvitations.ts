import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { createInviteClient } from '@/integrations/supabase/inviteClient';
import { useAuth } from '@/hooks/useAuth';

export const ACCEPT_INVITATION_PATH = '/accept-invitation';

export interface PendingInvitation {
  organizationId: string;
  organizationName: string;
  roleDisplayName: string | null;
  invitedAt: string;
  isExpired: boolean;
}

export const getInvitationRedirectUrl = () => `${window.location.origin}${ACCEPT_INVITATION_PATH}`;

/**
 * Emails an invitation link to an account that already exists in auth.users.
 * signUp/resend('signup') don't send anything for confirmed accounts, so we use a
 * magic link that signs the user in and lands them on the accept-invitation page.
 * Sent through the throwaway invite client so the admin's own session is untouched.
 */
export const sendExistingUserInvitationEmail = async (email: string) => {
  const { error } = await createInviteClient().auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: false,
      emailRedirectTo: getInvitationRedirectUrl(),
    },
  });
  if (error) throw error;
};

export const usePendingInvitations = () => {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['my-pending-invitations', user?.id],
    queryFn: async (): Promise<PendingInvitation[]> => {
      const { data, error } = await supabase.rpc('get_my_pending_invitations');
      if (error) throw error;
      return (data || []).map((row) => ({
        organizationId: row.organization_id,
        organizationName: row.organization_name,
        roleDisplayName: row.role_display_name,
        invitedAt: row.invited_at,
        isExpired: row.is_expired,
      }));
    },
    enabled: !!user,
  });
};

export const useAcceptInvitation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (organizationId: string) => {
      const { error } = await supabase.rpc('accept_organization_invitation', {
        _organization_id: organizationId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-pending-invitations'] });
    },
  });
};
