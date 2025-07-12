
import React from 'react';
import Layout from '@/components/Layout';
import { SEO } from '@/components/SEO';
import FactoryManagement from '@/components/FactoryManagement';

const FactoryPage = () => {
  return (
    <>
      <SEO
        title="工廠管理"
        description="管理合作工廠資料，追蹤生產進度，協調製造排程。完整的工廠協作管理系統。"
        keywords="工廠管理, 生產管理, 製造排程, 工廠協作, 生產進度"
      />
      <Layout>
        <div className="space-y-6">
          <FactoryManagement />
        </div>
      </Layout>
    </>
  );
};

export default FactoryPage;
