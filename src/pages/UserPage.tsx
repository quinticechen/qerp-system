
import React from 'react';
import Layout from '@/components/Layout';
import { UserManagement } from '@/components/user/UserManagement';
import { PermissionGuard } from '@/components/PermissionGuard';

const UserPage = () => {
  return (
    <Layout>
      <PermissionGuard permission="canViewUsers">
        <UserManagement />
      </PermissionGuard>
    </Layout>
  );
};

export default UserPage;
