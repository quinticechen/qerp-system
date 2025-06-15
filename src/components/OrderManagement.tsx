
import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ShoppingCart } from 'lucide-react';

const OrderManagement = () => {
  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-slate-800">訂單管理</h2>
      </div>
      
      <Card>
        <CardContent className="p-12 text-center">
          <ShoppingCart size={48} className="mx-auto text-slate-400 mb-4" />
          <h3 className="text-xl font-semibold text-slate-600 mb-2">訂單管理功能</h3>
          <p className="text-slate-500">此功能正在開發中...</p>
        </CardContent>
      </Card>
    </div>
  );
};

export default OrderManagement;
