
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AlertTriangle } from 'lucide-react';
import { StockAlertManager } from './StockAlertManager';
import { StockAlertNotification } from './StockAlertNotification';
import { useStockAlert } from '@/hooks/useStockAlert';

export const StockAlertSection: React.FC = () => {
  const { data: lowStockProducts = [], isLoading } = useStockAlert();

  return (
    <div className="space-y-6">
      {/* 庫存預警通知 */}
      {!isLoading && lowStockProducts.length > 0 && (
        <StockAlertNotification lowStockProducts={lowStockProducts} />
      )}

      <Tabs defaultValue="alerts" className="space-y-4">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="alerts" className="text-gray-900 data-[state=active]:text-gray-900 data-[state=inactive]:text-gray-600">
            <AlertTriangle className="mr-2 h-4 w-4" />
            預警通知
          </TabsTrigger>
          <TabsTrigger value="settings" className="text-gray-900 data-[state=active]:text-gray-900 data-[state=inactive]:text-gray-600">
            設定管理
          </TabsTrigger>
        </TabsList>
        
        <TabsContent value="alerts">
          <Card>
            <CardHeader>
              <CardTitle className="text-gray-900">庫存預警狀態</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="text-center py-8 text-gray-500">檢查庫存狀態中...</div>
              ) : lowStockProducts.length === 0 ? (
                <div className="text-center py-8 text-green-600">
                  ✅ 所有產品庫存充足
                </div>
              ) : (
                <StockAlertNotification lowStockProducts={lowStockProducts} />
              )}
            </CardContent>
          </Card>
        </TabsContent>
        
        <TabsContent value="settings">
          <StockAlertManager />
        </TabsContent>
      </Tabs>
    </div>
  );
};
