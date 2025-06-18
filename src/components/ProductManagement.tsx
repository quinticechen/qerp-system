
import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import { useProducts, Product } from '@/hooks/useProducts';
import { CreateProductDialog } from './product/CreateProductDialog';
import { EditProductDialog } from './product/EditProductDialog';
import ProductList from './product/ProductList';
import { PermissionGuard } from './PermissionGuard';
import { usePermissions } from '@/hooks/usePermissions';

const ProductManagement = () => {
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const { permissions } = usePermissions();
  
  const {
    products,
    loading,
    hasMore,
    searchTerm,
    categoryFilter,
    statusFilter,
    createProduct,
    updateProduct,
    loadMore,
    search,
    filterByCategory,
    filterByStatus,
  } = useProducts();

  const handleEdit = (product: Product) => {
    setSelectedProduct(product);
    setIsEditDialogOpen(true);
  };

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

        <Card>
          <CardHeader>
            <CardTitle>產品列表</CardTitle>
            <CardDescription>
              管理所有產品資訊，包括新增、編輯和狀態變更
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ProductList
              products={products}
              loading={loading}
              hasMore={hasMore}
              searchTerm={searchTerm}
              categoryFilter={categoryFilter}
              statusFilter={statusFilter}
              onSearch={search}
              onCategoryFilter={filterByCategory}
              onStatusFilter={filterByStatus}
              onLoadMore={loadMore}
              onEdit={handleEdit}
              canEdit={permissions.canEditProducts}
            />
          </CardContent>
        </Card>

        <PermissionGuard permission="canCreateProducts">
          <CreateProductDialog
            open={isCreateDialogOpen}
            onOpenChange={setIsCreateDialogOpen}
            onSubmit={createProduct}
          />
        </PermissionGuard>

        <PermissionGuard permission="canEditProducts">
          <EditProductDialog
            open={isEditDialogOpen}
            onOpenChange={setIsEditDialogOpen}
            product={selectedProduct}
            onSubmit={updateProduct}
          />
        </PermissionGuard>
      </div>
    </PermissionGuard>
  );
};

export default ProductManagement;
