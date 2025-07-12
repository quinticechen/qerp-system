
import React from 'react';
import Layout from '@/components/Layout';
import { SEO } from '@/components/SEO';
import ShippingManagement from '@/components/ShippingManagement';

const ShippingPage = () => {
  return (
    <>
      <SEO
        title="出貨管理"
        description="安排出貨作業，追蹤物流狀態，管理運輸配送。高效的出貨管理系統。"
        keywords="出貨管理, 物流管理, 運輸配送, 出貨追蹤, 配送狀態"
      />
      <Layout>
        <div className="space-y-6">
          <ShippingManagement />
        </div>
      </Layout>
    </>
  );
};

export default ShippingPage;
