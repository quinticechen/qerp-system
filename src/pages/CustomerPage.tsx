
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
          <div className="border-b border-gray-200 pb-4">
            <h1 className="text-3xl font-bold text-slate-800 mb-2">客戶管理</h1>
            <p className="text-slate-600">維護客戶資料與關係，追蹤客戶互動歷史</p>
          </div>
          <CustomerManagement />
        </div>
      </Layout>
    </>
  );
};

export default CustomerPage;
