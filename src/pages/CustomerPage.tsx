
import React from 'react';
import Layout from '@/components/Layout';
import { SEO } from '@/components/SEO';
import CustomerManagement from '@/components/CustomerManagement';

const CustomerPage = () => {
  return (
    <>
      <SEO
        title="客戶管理"
        description="管理客戶資料，維護客戶關係，追蹤客戶訂單歷史。建立完整的客戶資料庫。"
        keywords="客戶管理, 客戶資料, 客戶關係管理, CRM, 客戶資料庫"
      />
      <Layout>
        <div className="space-y-6">
          <CustomerManagement />
        </div>
      </Layout>
    </>
  );
};

export default CustomerPage;
