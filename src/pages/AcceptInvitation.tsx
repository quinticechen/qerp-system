import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Building2 } from 'lucide-react';
import { SEO } from '@/components/SEO';
import { PendingInvitationsCard } from '@/components/organization/PendingInvitationsCard';
import { useOrganizationContext } from '@/contexts/OrganizationContext';

const AcceptInvitation = () => {
  const navigate = useNavigate();
  const { hasNoOrganizations } = useOrganizationContext();

  return (
    <>
      <SEO title="組織邀請" description="查看並接受組織邀請" keywords="組織邀請" />
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="max-w-2xl w-full space-y-6">
          <div className="text-center">
            <Building2 className="mx-auto h-12 w-12 text-blue-600" />
            <h1 className="mt-4 text-3xl font-bold text-gray-900">組織邀請</h1>
          </div>

          <PendingInvitationsCard showEmptyState />

          <div className="text-center">
            <Button
              variant="outline"
              onClick={() => navigate(hasNoOrganizations ? '/create-organization' : '/dashboard')}
              className="border-gray-300 text-gray-700"
            >
              {hasNoOrganizations ? '前往建立組織' : '返回系統'}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
};

export default AcceptInvitation;
