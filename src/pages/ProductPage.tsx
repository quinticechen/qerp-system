
import React from 'react';
import Layout from '@/components/Layout';
import { SEO } from '@/components/SEO';
import ProductManagement from '@/components/ProductManagement';

const ProductPage = () => {
  return (
    <>
      <SEO
        title="產品管理"
        description="管理紡織產品資料，包含產品規格、庫存狀況、價格設定。輕鬆建立、編輯和查看所有產品資訊。"
        keywords="產品管理, 紡織產品, 庫存管理, 產品規格, 價格管理"
      />
      <Layout>
        <div className="space-y-6">
          <ProductManagement />
        </div>
      </Layout>
    </>
  );
};

export default ProductPage;
