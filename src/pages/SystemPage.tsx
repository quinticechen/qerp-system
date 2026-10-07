
import React from 'react';
import Layout from '@/components/Layout';
import { SEO } from '@/components/SEO';
import SystemSettings from '@/components/SystemSettings';

const SystemPage = () => {
  return (
    <>
      <SEO
        title="組織設定"
        description="管理組織參數設定，調整系統功能，維護系統運作。完整的組織管理介面。"
        keywords="組織設定, 系統管理, 參數設定, 系統維護, 系統配置"
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
