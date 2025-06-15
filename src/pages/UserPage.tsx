
import React from 'react';
import Layout from '@/components/Layout';
import { Card, CardContent } from '@/components/ui/card';
import { User } from 'lucide-react';

const UserPage = () => {
  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <h2 className="text-2xl font-bold text-slate-800">用戶管理</h2>
        </div>
        
        <Card>
          <CardContent className="p-12 text-center">
            <User size={48} className="mx-auto text-slate-400 mb-4" />
            <h3 className="text-xl font-semibold text-slate-600 mb-2">用戶管理功能</h3>
            <p className="text-slate-500">此功能正在開發中...</p>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
};

export default UserPage;
