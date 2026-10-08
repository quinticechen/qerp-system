import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { EditShippingDialog } from './EditShippingDialog';
import { ViewShippingDialog } from './ViewShippingDialog';
import { EnhancedTable, TableColumn } from '@/components/ui/enhanced-table';
import { useCurrentOrganization } from '@/hooks/useCurrentOrganization';
import { usePermissions } from '@/hooks/usePermissions';

export const ShippingList = () => {
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('canEditShipping');
  const [selectedShipping, setSelectedShipping] = useState<any | null>(null);
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const { organizationId, hasOrganization } = useCurrentOrganization();

  const { data: shippings, isLoading, refetch } = useQuery({
    queryKey: ['shippings', organizationId],
    queryFn: async () => {
      if (!organizationId) {
        console.log('No organization ID available');
        return [];
      }

      console.log('Fetching shippings for organization:', organizationId);
      const { data, error } = await supabase
        .from('shippings')
        .select(`
          *,
          orders (order_number, status),
          customers (name),
          shipping_items (
            id,
            shipped_quantity,
            inventory_rolls (
              id,
              roll_number,
              products_new (name, color)
            )
          )
        `)
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching shippings:', error);
        throw error;
      }

      console.log('Fetched shippings:', data);
      return data;
    },
    enabled: hasOrganization
  });

  const handleView = (shipping: any) => {
    setSelectedShipping(shipping);
    setViewDialogOpen(true);
  };

  const columns: TableColumn[] = [
    {
      key: 'shipping_number',
      title: '出貨單號',
      sortable: true,
      filterable: false,
      render: (value) => <span className="font-medium text-gray-900">{value}</span>
    },
    {
      key: 'orders.order_number',
      title: '訂單號',
      sortable: true,
      filterable: false,
      render: (value, row) => <span className="text-gray-700">{row.orders?.order_number}</span>
    },
    {
      key: 'customers.name',
      title: '客戶',
      sortable: true,
      filterable: false,
      render: (value, row) => <span className="text-gray-700">{row.customers?.name}</span>
    },
    {
      key: 'shipping_date',
      title: '出貨日期',
      sortable: true,
      filterable: false,
      render: (value) => (
        <span className="text-gray-700">
          {new Date(value).toLocaleDateString('zh-TW')}
        </span>
      )
    },
    {
      key: 'total_shipped_quantity',
      title: '總出貨量',
      sortable: true,
      filterable: false,
      render: (value) => <span className="text-gray-700">{value} KG</span>
    },
    {
      key: 'total_shipped_rolls',
      title: '總卷數',
      sortable: true,
      filterable: false,
      render: (value) => <span className="text-gray-700">{value}</span>
    },
    {
      key: 'note',
      title: '備註',
      sortable: false,
      filterable: false,
      render: (value) => <span className="text-gray-700">{value || '-'}</span>
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
          <CardTitle className="text-gray-900">出貨記錄列表</CardTitle>
        </CardHeader>
        <CardContent>
          <EnhancedTable
            columns={columns}
            data={shippings || []}
            loading={isLoading}
            searchPlaceholder="搜尋出貨單號、訂單號、客戶名稱..."
            emptyMessage="沒有找到出貨記錄"
            onRowClick={handleView}
          />
        </CardContent>
      </Card>

      {/* 對話框 */}
      {selectedShipping && (
        <>
          <ViewShippingDialog
            open={viewDialogOpen}
            onOpenChange={setViewDialogOpen}
            shipping={selectedShipping}
            onEdit={canEdit ? () => {
              setViewDialogOpen(false);
              setEditDialogOpen(true);
            } : undefined}
          />
          <EditShippingDialog
            open={editDialogOpen}
            onOpenChange={setEditDialogOpen}
            shipping={selectedShipping}
          />
        </>
      )}
    </div>
  );
};
