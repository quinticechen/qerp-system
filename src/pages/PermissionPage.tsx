
import React from 'react';
import Layout from '@/components/Layout';
import { PermissionManagement } from '@/components/permission/PermissionManagement';
import { PermissionGuard } from '@/components/PermissionGuard';

const PermissionPage = () => {
  return (
    <Layout>
      <PermissionGuard permission="canViewPermissions">
        <PermissionManagement />
      </PermissionGuard>
    </Layout>
  );
};

export default PermissionPage;
