
import React from 'react';
import Layout from '@/components/Layout';
import { SEO } from '@/components/SEO';
import SystemSettings from '@/components/SystemSettings';

const SystemPage = () => {
  return (
    <>
      <SEO
        title="系統設定"
        description="管理系統參數設定，調整系統功能，維護系統運作。完整的系統管理介面。"
        keywords="系統設定, 系統管理, 參數設定, 系統維護, 系統配置"
      />
      <Layout>
        <div className="space-y-6">
          <SystemSettings />
        </div>
      </Layout>
    </>
  );
};

export default SystemPage;
