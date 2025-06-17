
import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Plus, Package, AlertTriangle } from 'lucide-react';
import { ProductList } from './product/ProductList';
import { CreateProductDialog } from './product/CreateProductDialog';
import { StockAlertSection } from './inventory/StockAlertSection';

const ProductManagement = () => {
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">產品管理</h2>
          <p className="text-gray-600 mt-1">管理產品資訊和庫存預警設定</p>
        </div>
        <Button 
          onClick={() => setIsCreateDialogOpen(true)}
          className="bg-blue-600 text-white hover:bg-blue-700 border-0 shadow-sm"
        >
          <Plus className="mr-2 h-4 w-4" />
          新增產品
        </Button>
      </div>
      
      <Tabs defaultValue="products" className="space-y-4">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="products" className="text-gray-900 data-[state=active]:text-gray-900 data-[state=inactive]:text-gray-600">
            <Package className="mr-2 h-4 w-4" />
            產品列表
          </TabsTrigger>
          <TabsTrigger value="stock-alerts" className="text-gray-900 data-[state=active]:text-gray-900 data-[state=inactive]:text-gray-600">
            <AlertTriangle className="mr-2 h-4 w-4" />
            庫存預警
          </TabsTrigger>
        </TabsList>
        
        <TabsContent value="products">
          <ProductList />
        </TabsContent>
        
        <TabsContent value="stock-alerts">
          <StockAlertSection />
        </TabsContent>
      </Tabs>
      
      <CreateProductDialog 
        open={isCreateDialogOpen}
        onOpenChange={setIsCreateDialogOpen}
      />
    </div>
  );
};

export default ProductManagement;
