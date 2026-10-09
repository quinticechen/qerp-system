import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { EnhancedTable, TableColumn } from '@/components/ui/enhanced-table';
import { useCurrentOrganization } from '@/hooks/useCurrentOrganization';
import { usePermissions } from '@/hooks/usePermissions';
import { lastArrivalDate } from '@/lib/purchaseArrivals';
import { PurchaseDialog } from './PurchaseDialog';

interface PurchaseListProps {
  // The purchase order open in the dialog; the page opens a newly created one here too
  selectedId: string | null;
  onSelectedIdChange: (id: string | null) => void;
}

export const PurchaseList = ({ selectedId, onSelectedIdChange }: PurchaseListProps) => {
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('canEditPurchases');
  const { organizationId, hasOrganization } = useCurrentOrganization();

  const { data: purchases, isLoading } = useQuery({
    queryKey: ['purchases', organizationId],
    queryFn: async () => {
      if (!organizationId) {
        console.log('No organization ID available');
        return [];
      }

      console.log('Fetching purchases for organization:', organizationId);
      const { data, error } = await supabase
        .from('purchase_orders')
        .select(`
          *,
          factories (name),
          purchase_order_items (
            id,
            product_id,
            ordered_quantity,
            received_quantity,
            unit_price,
            products_new (name, color)
          ),
          purchase_order_relations (
            orders (order_number, note)
          ),
          inventories (
            id,
            receipt_number,
            arrival_date,
            inventory_rolls (product_id)
          )
        `)
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching purchases:', error);
        throw error;
      }

      // The list shows when goods last arrived; the detail shows it per product
      return (data ?? []).map((purchase) => ({ ...purchase, last_arrival_date: lastArrivalDate(purchase.inventories) }));
    },
    enabled: hasOrganization
  });

  const handleView = (purchase: { id: string }) => onSelectedIdChange(purchase.id);

  const getStatusBadge = (status: string) => {
    const statusMap = {
      'pending': 'bg-yellow-100 text-yellow-800 border-yellow-200',
      'confirmed': 'bg-blue-100 text-blue-800 border-blue-200',
      'partial_received': 'bg-orange-100 text-orange-800 border-orange-200',
      'completed': 'bg-green-100 text-green-800 border-green-200',
      'cancelled': 'bg-red-100 text-red-800 border-red-200'
    };
    return statusMap[status as keyof typeof statusMap] || 'bg-gray-100 text-gray-800 border-gray-200';
  };

  const getStatusText = (status: string) => {
    const textMap = {
      'pending': '待確認',
      'confirmed': '已下單',
      'partial_received': '部分入庫',
      'completed': '已完成',
      'cancelled': '已取消'
    };
    return textMap[status as keyof typeof textMap] || status;
  };

  const columns: TableColumn[] = [
    {
      key: 'po_number',
      title: '採購單號',
      sortable: true,
      filterable: false,
      render: (value) => <span className="font-medium text-gray-900">{value}</span>
    },
    {
      key: 'factories.name',
      title: '工廠',
      sortable: true,
      filterable: false,
      render: (value, row) => <span className="text-gray-700">{row.factories?.name}</span>
    },
    {
      key: 'status',
      title: '狀態',
      sortable: true,
      filterable: true,
      filterOptions: [
        { value: 'pending', label: '待確認' },
        { value: 'confirmed', label: '已下單' },
        { value: 'partial_received', label: '部分入庫' },
        { value: 'completed', label: '已完成' },
        { value: 'cancelled', label: '已取消' }
      ],
      render: (value) => (
        <Badge variant="outline" className={getStatusBadge(value)}>
          {getStatusText(value)}
        </Badge>
      )
    },
    {
      key: 'order_date',
      title: '下單日期',
      sortable: true,
      filterable: false,
      render: (value) => (
        <span className="text-gray-700">
          {new Date(value).toLocaleDateString('zh-TW')}
        </span>
      )
    },
    {
      key: 'expected_arrival_date',
      title: '預計到貨日期',
      sortable: true,
      filterable: false,
      render: (value) => (
        <span className="text-gray-700">
          {value ? new Date(value).toLocaleDateString('zh-TW') : '未設定'}
        </span>
      )
    },
    {
      key: 'total_amount',
      title: '總金額',
      sortable: true,
      filterable: false,
      render: (value, row) => {
        const totalAmount = row.purchase_order_items?.reduce(
          (sum: number, item: any) => sum + (item.ordered_quantity * item.unit_price), 
          0
        ) || 0;
        return <span className="text-gray-700">NT$ {totalAmount.toLocaleString()}</span>;
      }
    },
    {
      key: 'last_arrival_date',
      title: '最近入庫',
      sortable: true,
      filterable: false,
      render: (value) => <span className="text-gray-700">{value ? new Date(value).toLocaleDateString('zh-TW') : '-'}</span>
    },
    {
      key: 'note',
      title: '備註',
      sortable: false,
      filterable: false,
      render: (value) => <span className="block max-w-xs truncate text-gray-700" title={value || undefined}>{value || '-'}</span>
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

  const selectedPurchase = (purchases ?? []).find((purchase) => purchase.id === selectedId) ?? null;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-gray-900">採購單列表</CardTitle>
        </CardHeader>
        <CardContent>
          <EnhancedTable
            columns={columns}
            data={purchases || []}
            loading={isLoading}
            searchPlaceholder="搜尋採購單號、工廠名稱..."
            emptyMessage="沒有找到採購單"
            onRowClick={handleView}
          />
        </CardContent>
      </Card>

      {selectedPurchase && (
        <PurchaseDialog
          open
          onOpenChange={(open) => !open && onSelectedIdChange(null)}
          purchase={selectedPurchase}
          canEdit={canEdit}
        />
      )}
    </div>
  );
};
