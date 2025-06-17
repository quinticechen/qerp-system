
import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Eye, Edit } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { ViewInventoryDialog } from './ViewInventoryDialog';
import { EnhancedTable, TableColumn } from '@/components/ui/enhanced-table';

export const InventoryList = () => {
  const [selectedInventory, setSelectedInventory] = useState<any | null>(null);
  const [viewDialogOpen, setViewDialogOpen] = useState(false);

  const { data: inventories, isLoading } = useQuery({
    queryKey: ['inventories'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inventories')
        .select(`
          *,
          factories (name),
          purchase_orders (po_number),
          inventory_rolls (
            id,
            roll_number,
            quantity,
            current_quantity,
            quality,
            products_new (name, color)
          )
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data;
    }
  });

  const { data: factories } = useQuery({
    queryKey: ['factories'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('factories')
        .select('id, name')
        .order('name');
      
      if (error) throw error;
      return data;
    }
  });

  const getQualityBadge = (quality: string) => {
    const qualityMap = {
      A: 'bg-green-100 text-green-800 border-green-200',
      B: 'bg-blue-100 text-blue-800 border-blue-200',
      C: 'bg-yellow-100 text-yellow-800 border-yellow-200',
      D: 'bg-orange-100 text-orange-800 border-orange-200',
      defective: 'bg-red-100 text-red-800 border-red-200'
    };
    return qualityMap[quality as keyof typeof qualityMap] || 'bg-gray-100 text-gray-800 border-gray-200';
  };

  const handleView = (inventory: any) => {
    setSelectedInventory(inventory);
    setViewDialogOpen(true);
  };

  const columns: TableColumn[] = [
    {
      key: 'purchase_orders.po_number',
      title: '採購單號',
      sortable: true,
      filterable: false,
      render: (value, row) => <span className="font-medium text-gray-900">{row.purchase_orders?.po_number}</span>
    },
    {
      key: 'factories.name',
      title: '工廠',
      sortable: true,
      filterable: true,
      filterOptions: factories?.map(factory => ({
        value: factory.id,
        label: factory.name
      })) || [],
      render: (value, row) => <span className="text-gray-700">{row.factories?.name}</span>
    },
    {
      key: 'arrival_date',
      title: '到貨日期',
      sortable: true,
      filterable: false,
      render: (value) => (
        <span className="text-gray-700">
          {new Date(value).toLocaleDateString('zh-TW')}
        </span>
      )
    },
    {
      key: 'total_quantity',
      title: '總重量',
      sortable: true,
      filterable: false,
      render: (value, row) => {
        const totalQuantity = row.inventory_rolls?.reduce(
          (sum: number, roll: any) => sum + roll.quantity, 
          0
        ) || 0;
        return <span className="text-gray-700">{totalQuantity.toFixed(2)} 公斤</span>;
      }
    },
    {
      key: 'total_rolls',
      title: '總卷數',
      sortable: true,
      filterable: false,
      render: (value, row) => <span className="text-gray-700">{row.inventory_rolls?.length || 0}</span>
    },
    {
      key: 'quality_distribution',
      title: '品質分布',
      sortable: false,
      filterable: false,
      render: (value, row) => {
        const qualityCount = row.inventory_rolls?.reduce((acc: any, roll: any) => {
          acc[roll.quality] = (acc[roll.quality] || 0) + 1;
          return acc;
        }, {}) || {};
        
        return (
          <div className="flex flex-wrap gap-1">
            {Object.entries(qualityCount).map(([quality, count]) => (
              <Badge key={quality} variant="outline" className={`text-xs ${getQualityBadge(quality)}`}>
                {quality}: {count as number}
              </Badge>
            ))}
          </div>
        );
      }
    },
    {
      key: 'note',
      title: '備註',
      sortable: false,
      filterable: false,
      render: (value) => <span className="text-gray-700">{value || '-'}</span>
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
          <CardTitle className="text-gray-900">入庫記錄列表</CardTitle>
        </CardHeader>
        <CardContent>
          <EnhancedTable
            columns={columns}
            data={inventories || []}
            loading={isLoading}
            searchPlaceholder="搜尋採購單號、工廠名稱、備註..."
            emptyMessage="沒有找到入庫記錄"
          />
        </CardContent>
      </Card>

      {/* 對話框 */}
      {selectedInventory && (
        <ViewInventoryDialog
          open={viewDialogOpen}
          onOpenChange={setViewDialogOpen}
          inventory={selectedInventory}
        />
      )}
    </div>
  );
};
