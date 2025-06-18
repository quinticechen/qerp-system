
import React from 'react';
import Layout from '@/components/Layout';
import { OrganizationRoleManagement } from '@/components/organization/OrganizationRoleManagement';
import { PermissionGuard } from '@/components/PermissionGuard';

const OrganizationRolePage = () => {
  return (
    <Layout>
      <PermissionGuard permission="canManageRoles">
        <OrganizationRoleManagement />
      </PermissionGuard>
    </Layout>
  );
};

export default OrganizationRolePage;
