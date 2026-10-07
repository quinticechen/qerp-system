import React from 'react';
import Layout from '@/components/Layout';
import { SEO } from '@/components/SEO';
import { ShelfManagement } from '@/components/inventory/ShelfManagement';

const ShelfPage = () => {
  return (
    <>
      <SEO
        title="貨架管理"
        description="管理倉庫貨架，查看每個貨架存放的產品與數量。"
        keywords="貨架管理, 倉庫貨架, 庫存位置, 布卷存放"
      />
      <Layout>
        <div className="space-y-6">
          <ShelfManagement />
        </div>
      </Layout>
    </>
  );
};

export default ShelfPage;
