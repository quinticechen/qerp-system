import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { ShippingDialog } from './ShippingDialog';
import { EnhancedTable, TableColumn } from '@/components/ui/enhanced-table';
import { useCurrentOrganization } from '@/hooks/useCurrentOrganization';
import { usePermissions } from '@/hooks/usePermissions';

interface ShippingListProps {
  // The shipping open in the dialog; the page opens a newly created one here too
  selectedId: string | null;
  onSelectedIdChange: (id: string | null) => void;
}

export const ShippingList = ({ selectedId, onSelectedIdChange }: ShippingListProps) => {
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('canEditShipping');
  const { organizationId, hasOrganization } = useCurrentOrganization();

  const { data: shippings, isLoading } = useQuery({
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

  const handleView = (shipping: { id: string }) => onSelectedIdChange(shipping.id);

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
      key: 'status',
      title: '狀態',
      sortable: true,
      filterable: true,
      filterOptions: [
        { value: 'shipped', label: '已出貨' },
        { value: 'cancelled', label: '已取消' }
      ],
      render: (value) => (
        <Badge
          variant="outline"
          className={value === 'cancelled' ? 'border-red-200 bg-red-100 text-red-800' : 'border-green-200 bg-green-100 text-green-800'}
        >
          {value === 'cancelled' ? '已取消' : '已出貨'}
        </Badge>
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

  const selectedShipping = (shippings ?? []).find((shipping) => shipping.id === selectedId) ?? null;

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

      {selectedShipping && (
        <ShippingDialog
          open
          onOpenChange={(open) => !open && onSelectedIdChange(null)}
          shipping={selectedShipping}
          canEdit={canEdit}
        />
      )}
    </div>
  );
};
