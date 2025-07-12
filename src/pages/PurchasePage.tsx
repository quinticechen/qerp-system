
import React from 'react';
import Layout from '@/components/Layout';
import { SEO } from '@/components/SEO';
import PurchaseManagement from '@/components/PurchaseManagement';

const PurchasePage = () => {
  return (
    <>
      <SEO
        title="採購管理"
        description="管理採購訂單，追蹤採購進度，控制採購成本。完整的採購流程管理系統。"
        keywords="採購管理, 採購訂單, 供應商管理, 採購成本, 採購流程"
      />
      <Layout>
        <div className="space-y-6">
          <PurchaseManagement />
        </div>
      </Layout>
    </>
  );
};

export default PurchasePage;
