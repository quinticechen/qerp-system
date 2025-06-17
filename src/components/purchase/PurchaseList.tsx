
import React, { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Eye, Edit } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { ViewPurchaseDialog } from './ViewPurchaseDialog';
import { EditPurchaseDialog } from './EditPurchaseDialog';
import { useDebounce } from '@/hooks/useDebounce';
import { EnhancedTable, TableColumn } from '@/components/ui/enhanced-table';

export const PurchaseList = () => {
  const [selectedPurchase, setSelectedPurchase] = useState<any | null>(null);
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);

  const { data: purchases, isLoading } = useQuery({
    queryKey: ['purchases'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('purchase_orders')
        .select(`
          *,
          factories (name),
          purchase_order_items (
            id,
            ordered_quantity,
            ordered_rolls,
            unit_price,
            products_new (name, color)
          ),
          purchase_order_relations (
            orders (
              id,
              order_number,
              note
            )
          )
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data;
    }
  });

  const getStatusBadge = (status: string) => {
    const statusMap = {
      pending: 'bg-yellow-100 text-yellow-800 border-yellow-200',
      confirmed: 'bg-blue-100 text-blue-800 border-blue-200',
      partial_arrived: 'bg-orange-100 text-orange-800 border-orange-200',
      completed: 'bg-green-100 text-green-800 border-green-200',
      cancelled: 'bg-red-100 text-red-800 border-red-200'
    };
    return statusMap[status as keyof typeof statusMap] || 'bg-gray-100 text-gray-800 border-gray-200';
  };

  const getStatusText = (status: string) => {
    const textMap = {
      pending: '待確認',
      confirmed: '已確認',
      partial_arrived: '部分到貨',
      completed: '已完成',
      cancelled: '已取消'
    };
    return textMap[status as keyof typeof textMap] || status;
  };

  const handleView = (purchase: any) => {
    setSelectedPurchase(purchase);
    setViewDialogOpen(true);
  };

  const handleEdit = (purchase: any) => {
    setSelectedPurchase(purchase);
    setEditDialogOpen(true);
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
        { value: 'confirmed', label: '已確認' },
        { value: 'partial_arrived', label: '部分到貨' },
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
      key: 'total_quantity',
      title: '總數量',
      sortable: true,
      filterable: false,
      render: (value, row) => {
        const totalQuantity = row.purchase_order_items?.reduce(
          (sum: number, item: any) => sum + item.ordered_quantity, 
          0
        ) || 0;
        return <span className="text-gray-700">{totalQuantity.toFixed(2)} 公斤</span>;
      }
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
        return <span className="text-gray-700">${totalAmount.toFixed(2)}</span>;
      }
    },
    {
      key: 'items_count',
      title: '項目數',
      sortable: true,
      filterable: false,
      render: (value, row) => <span className="text-gray-700">{row.purchase_order_items?.length || 0}</span>
    },
    {
      key: 'expected_arrival_date',
      title: '預計到貨',
      sortable: true,
      filterable: false,
      render: (value) => (
        <span className="text-gray-700">
          {value ? new Date(value).toLocaleDateString('zh-TW') : '未設定'}
        </span>
      )
    },
    {
      key: 'related_orders',
      title: '關聯訂單',
      sortable: false,
      filterable: false,
      render: (value, row) => {
        const relatedOrders = row.purchase_order_relations?.map((rel: any) => rel.orders) || [];
        return relatedOrders.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {relatedOrders.map((order: any, index: number) => (
              <Badge key={index} variant="outline" className="text-xs">
                {order.order_number}
              </Badge>
            ))}
          </div>
        ) : (
          <span className="text-gray-500">-</span>
        );
      }
    },
    {
      key: 'actions',
      title: '操作',
      sortable: false,
      filterable: false,
      render: (value, row) => (
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleView(row)}
            className="border-gray-300 text-gray-700 hover:bg-gray-50"
          >
            <Eye className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleEdit(row)}
            className="border-gray-300 text-gray-700 hover:bg-gray-50"
          >
            <Edit className="h-4 w-4" />
          </Button>
        </div>
      )
    }
  ];

  if (isLoading) {
    return <div className="text-center py-8 text-gray-500">載入中...</div>;
  }

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
            searchPlaceholder="搜尋採購單號、工廠名稱、訂單號..."
            emptyMessage="沒有找到採購單"
          />
        </CardContent>
      </Card>

      {/* 對話框 */}
      {selectedPurchase && (
        <>
          <ViewPurchaseDialog
            open={viewDialogOpen}
            onOpenChange={setViewDialogOpen}
            purchase={selectedPurchase}
          />
          <EditPurchaseDialog
            open={editDialogOpen}
            onOpenChange={setEditDialogOpen}
            purchase={selectedPurchase}
          />
        </>
      )}
    </div>
  );
};
