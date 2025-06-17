
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export const ProductList: React.FC = () => {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-gray-900">產品列表</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-center py-8 text-gray-500">
          產品列表功能開發中...
        </div>
      </CardContent>
    </Card>
  );
};
