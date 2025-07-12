
import React from 'react';
import Layout from '@/components/Layout';
import { SEO } from '@/components/SEO';
import OrderManagement from '@/components/OrderManagement';

const OrderPage = () => {
  return (
    <>
      <SEO
        title="訂單管理"
        description="管理客戶訂單，追蹤訂單狀態，處理出貨安排。完整的訂單生命週期管理系統。"
        keywords="訂單管理, 客戶訂單, 訂單追蹤, 出貨管理, 訂單狀態"
      />
      <Layout>
        <div className="space-y-6">
          <OrderManagement />
        </div>
      </Layout>
    </>
  );
};

export default OrderPage;
