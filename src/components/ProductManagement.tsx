
import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import { CreateProductDialog } from './product/CreateProductDialog';
import ProductList from './product/ProductList';
import { PermissionGuard } from './PermissionGuard';

const ProductManagement = () => {
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);

  return (
    <PermissionGuard permission="canViewProducts">
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <h2 className="text-2xl font-bold text-gray-900">產品管理</h2>
          <PermissionGuard permission="canCreateProducts">
            <Button 
              onClick={() => setIsCreateDialogOpen(true)}
              className="bg-blue-600 text-white hover:bg-blue-700 border-0 shadow-sm"
            >
              <Plus className="mr-2 h-4 w-4" />
              新增產品
            </Button>
          </PermissionGuard>
        </div>

        <ProductList />

        <PermissionGuard permission="canCreateProducts">
          <CreateProductDialog
            open={isCreateDialogOpen}
            onOpenChange={setIsCreateDialogOpen}
          />
        </PermissionGuard>
      </div>
    </PermissionGuard>
  );
};

export default ProductManagement;
