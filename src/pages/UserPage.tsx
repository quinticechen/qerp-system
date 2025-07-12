
import React from 'react';
import Layout from '@/components/Layout';
import { SEO } from '@/components/SEO';
import { UserManagement } from '@/components/user/UserManagement';
import { PermissionGuard } from '@/components/PermissionGuard';

const UserPage = () => {
  return (
    <>
      <SEO
        title="使用者管理"
        description="管理系統使用者帳號，設定使用者權限，控制系統存取。完整的使用者權限管理系統。"
        keywords="使用者管理, 帳號管理, 權限控制, 系統管理, 使用者權限"
      />
      <Layout>
        <PermissionGuard permission="canViewUsers">
          <div className="space-y-6">
            <UserManagement />
          </div>
        </PermissionGuard>
      </Layout>
    </>
  );
};

export default UserPage;
