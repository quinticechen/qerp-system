import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Mail } from 'lucide-react';
import { toast } from 'sonner';
import { useOrganizationContext } from '@/contexts/OrganizationContext';
import { useAcceptInvitation, usePendingInvitations } from '@/hooks/useInvitations';

interface PendingInvitationsCardProps {
  /** Show an empty-state message instead of rendering nothing when there are no invitations. */
  showEmptyState?: boolean;
}

export const PendingInvitationsCard: React.FC<PendingInvitationsCardProps> = ({ showEmptyState = false }) => {
  const navigate = useNavigate();
  const { refreshOrganizations } = useOrganizationContext();
  const { data: invitations, isLoading } = usePendingInvitations();
  const acceptInvitation = useAcceptInvitation();

  const handleAccept = (organizationId: string, organizationName: string) => {
    acceptInvitation.mutate(organizationId, {
      onSuccess: async () => {
        // fetchUserOrganizations picks the saved organization as the current one
        localStorage.setItem('currentOrganizationId', organizationId);
        await refreshOrganizations();
        toast.success(`已加入「${organizationName}」`);
        navigate('/dashboard', { replace: true });
      },
      onError: (error: Error) => {
        toast.error(`接受邀請失敗: ${error.message}`);
      },
    });
  };

  if (isLoading) return null;
  if (!invitations || invitations.length === 0) {
    if (!showEmptyState) return null;
    return (
      <Card>
        <CardContent className="py-8 text-center text-gray-600">目前沒有待接受的組織邀請</CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-blue-200">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-gray-900">
          <Mail className="h-5 w-5 text-blue-600" />
          您有 {invitations.length} 個組織邀請
        </CardTitle>
        <CardDescription className="text-gray-700">接受邀請後即可進入該組織並取得指派的角色權限</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {invitations.map((invitation) => (
          <div
            key={invitation.organizationId}
            className="flex flex-col gap-3 rounded-lg border border-gray-200 p-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="space-y-1">
              <div className="font-medium text-gray-900">{invitation.organizationName}</div>
              <div className="flex flex-wrap items-center gap-2 text-sm text-gray-600">
                {invitation.roleDisplayName && <Badge variant="outline">{invitation.roleDisplayName}</Badge>}
                <span>邀請時間：{new Date(invitation.invitedAt).toLocaleDateString('zh-TW')}</span>
              </div>
            </div>
            {invitation.isExpired ? (
              <Badge variant="outline" className="bg-red-100 text-red-800 border-red-200">
                已過期，請聯絡管理員重新發送
              </Badge>
            ) : (
              <Button
                onClick={() => handleAccept(invitation.organizationId, invitation.organizationName)}
                disabled={acceptInvitation.isPending}
                className="bg-blue-600 text-white hover:bg-blue-700"
              >
                接受邀請
              </Button>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
};
