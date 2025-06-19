
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
          <div className="border-b border-gray-200 pb-4">
            <h1 className="text-3xl font-bold text-slate-800 mb-2">採購管理</h1>
            <p className="text-slate-600">管理採購流程，追蹤採購訂單與供應商</p>
          </div>
          <PurchaseManagement />
        </div>
      </Layout>
    </>
  );
};

export default PurchasePage;
