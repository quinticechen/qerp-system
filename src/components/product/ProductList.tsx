
import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { EditProductDialog } from './EditProductDialog';
import { EnhancedTable, TableColumn } from '@/components/ui/enhanced-table';
import { useCurrentOrganization } from '@/hooks/useCurrentOrganization';
import { usePermissions } from '@/hooks/usePermissions';

const ProductList = () => {
  const [selectedProduct, setSelectedProduct] = useState<any | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('canEditProducts');
  const { organizationId, hasOrganization } = useCurrentOrganization();

  const { data: products, isLoading, refetch } = useQuery({
    queryKey: ['products', organizationId],
    queryFn: async () => {
      if (!organizationId) {
        console.log('No organization ID available');
        return [];
      }

      console.log('Fetching products for organization:', organizationId);
      const { data, error } = await supabase
        .from('products_new')
        .select('*')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching products:', error);
        throw error;
      }

      console.log('Fetched products:', data);
      return data;
    },
    enabled: hasOrganization
  });

  const handleEdit = (product: any) => {
    setSelectedProduct(product);
    setEditDialogOpen(true);
  };

  const getStatusBadge = (status: string) => {
    const statusMap = {
      'Available': 'bg-green-100 text-green-800 border-green-200',
      'Unavailable': 'bg-red-100 text-red-800 border-red-200',
    };
    return statusMap[status as keyof typeof statusMap] || 'bg-gray-100 text-gray-800 border-gray-200';
  };

  const getStatusText = (status: string) => {
    const textMap = {
      'Available': '可用',
      'Unavailable': '不可用',
    };
    return textMap[status as keyof typeof textMap] || status;
  };

  const columns: TableColumn[] = [
    {
      key: 'name',
      title: '產品名稱',
      sortable: true,
      filterable: false,
      render: (value) => <span className="font-medium text-gray-900">{value}</span>
    },
    {
      key: 'color',
      title: '顏色',
      sortable: true,
      filterable: false,
      render: (value) => <span className="text-gray-700">{value}</span>
    },
    {
      key: 'color_code',
      title: '色碼',
      sortable: true,
      filterable: false,
      render: (value) => <span className="text-gray-700">{value || '未設定'}</span>
    },
    {
      key: 'category',
      title: '類別',
      sortable: true,
      filterable: true,
      filterOptions: [
        { value: '布料', label: '布料' },
        { value: '胚布', label: '胚布' },
        { value: '紗線', label: '紗線' },
        { value: '輔料', label: '輔料' }
      ],
      render: (value) => <span className="text-gray-700">{value}</span>
    },
    {
      key: 'status',
      title: '狀態',
      sortable: true,
      filterable: true,
      filterOptions: [
        { value: 'Available', label: '可用' },
        { value: 'Unavailable', label: '不可用' }
      ],
      render: (value) => (
        <Badge variant="outline" className={getStatusBadge(value)}>
          {getStatusText(value)}
        </Badge>
      )
    },
    {
      key: 'unit_of_measure',
      title: '單位',
      sortable: true,
      filterable: false,
      render: (value) => <span className="text-gray-700">{value}</span>
    },
    {
      key: 'stock_thresholds',
      title: '庫存警戒值',
      sortable: true,
      filterable: false,
      render: (value) => (
        <span className="text-gray-700">
          {value ? `${value} KG` : '未設定'}
        </span>
      )
    },
    {
      key: 'created_at',
      title: '建立時間',
      sortable: true,
      filterable: false,
      render: (value) => (
        <span className="text-gray-700">
          {new Date(value).toLocaleDateString('zh-TW')}
        </span>
      )
    },
  ];

  if (!hasOrganization) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="text-center text-gray-700">請先選擇組織</div>
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="text-center text-gray-700">載入中...</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-gray-900">產品列表</CardTitle>
        </CardHeader>
        <CardContent>
          <EnhancedTable
            columns={columns}
            data={products || []}
            loading={isLoading}
            searchPlaceholder="搜尋產品名稱、顏色、類別..."
            emptyMessage="沒有找到產品"
            onRowClick={handleEdit}
          />
        </CardContent>
      </Card>

      {/* 編輯對話框 */}
      {selectedProduct && (
        <EditProductDialog
          open={editDialogOpen}
          onOpenChange={setEditDialogOpen}
          product={selectedProduct}
          readOnly={!canEdit}
          onSubmit={async (id, data) => {
            try {
              const { error } = await supabase
                .from('products_new')
                .update(data)
                .eq('id', id);

              if (error) throw error;
              
              refetch();
              return true;
            } catch (error) {
              console.error('Error updating product:', error);
              return false;
            }
          }}
        />
      )}
    </div>
  );
};

export default ProductList;
