
import React from 'react';
import Layout from '@/components/Layout';
import { SEO } from '@/components/SEO';
import InventoryManagement from '@/components/InventoryManagement';

const InventoryPage = () => {
  return (
    <>
      <SEO
        title="庫存管理"
        description="即時監控庫存狀況，設定安全庫存，管理進出庫記錄。智能化庫存管理系統。"
        keywords="庫存管理, 庫存監控, 安全庫存, 進出庫管理, 庫存統計"
      />
      <Layout>
        <div className="space-y-6">
          <InventoryManagement />
        </div>
      </Layout>
    </>
  );
};

export default InventoryPage;
