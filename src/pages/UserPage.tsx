
import React from 'react';
import Layout from '@/components/Layout';
import { UserManagement } from '@/components/user/UserManagement';
import { useUserRole } from '@/hooks/useUserRole';

const UserPage = () => {
  const { isAdmin, loading } = useUserRole();

  if (loading) {
    return (
      <Layout>
        <div className="text-center py-8 text-gray-500">載入中...</div>
      </Layout>
    );
  }

  if (!isAdmin) {
    return (
      <Layout>
        <div className="text-center py-8">
          <h2 className="text-xl font-semibold text-gray-700 mb-2">權限不足</h2>
          <p className="text-gray-500">您沒有權限存取使用者管理功能</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <UserManagement />
    </Layout>
  );
};

export default UserPage;
