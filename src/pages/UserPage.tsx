
import React from 'react';
import { UserManagement } from '@/components/user/UserManagement';
import { useUserRole } from '@/hooks/useUserRole';

const UserPage = () => {
  const { isAdmin, loading } = useUserRole();

  if (loading) {
    return <div className="text-center py-8 text-gray-500">載入中...</div>;
  }

  if (!isAdmin) {
    return (
      <div className="text-center py-8">
        <h2 className="text-xl font-semibold text-gray-700 mb-2">權限不足</h2>
        <p className="text-gray-500">您沒有權限存取使用者管理功能</p>
      </div>
    );
  }

  return <UserManagement />;
};

export default UserPage;
