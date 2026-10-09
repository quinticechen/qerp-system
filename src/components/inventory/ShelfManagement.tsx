import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { EnhancedTable, type TableColumn } from '@/components/ui/enhanced-table';
import { Plus, Warehouse } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { usePermissions } from '@/hooks/usePermissions';
import { useShelves, type Shelf } from '@/hooks/useShelves';
import { CreateShelfDialog } from './CreateShelfDialog';
import { ShelfDialog } from './ShelfDialog';
import { PermissionGate } from '@/components/PermissionGate';

export const ShelfManagement: React.FC = () => {
  const { data: shelves, isLoading, error } = useShelves();
  const [openShelfId, setOpenShelfId] = useState<string | null>(null);
  const { hasPermission } = usePermissions();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const canEdit = hasPermission('canEditShelves');

  const columns: TableColumn[] = [
    {
      key: 'name',
      title: '貨架名稱',
      sortable: true,
      render: (value: string) => (
        <div className="flex items-center gap-2">
          <Warehouse className="h-4 w-4 shrink-0 text-blue-600" />
          <span className="font-medium text-gray-900">{value}</span>
        </div>
      ),
    },
    {
      key: 'rollCount',
      title: '布卷數',
      sortable: true,
      render: (value: number) => <span className="text-gray-700">{value > 0 ? `${value} 卷` : '-'}</span>,
    },
    {
      key: 'totalQuantity',
      title: '庫存數量 (kg)',
      sortable: true,
      render: (value: number, row: Shelf) =>
        row.rollCount > 0 ? (
          <span className="text-gray-700">{value.toFixed(2)}</span>
        ) : (
          <span className="text-gray-400">空貨架</span>
        ),
    },
    {
      key: 'isActive',
      title: '狀態',
      sortable: true,
      render: (value: boolean) => (
        <Badge
          variant="outline"
          className={value ? 'border-green-200 bg-green-100 text-green-800' : 'border-gray-300 bg-gray-100 text-gray-600'}
        >
          {value ? '啟用' : '停用'}
        </Badge>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-900">貨架管理</h2>
        <PermissionGate permission="canCreateShelves">
          <Button
            onClick={() => setIsCreateDialogOpen(true)}
            className="bg-blue-600 text-white hover:bg-blue-700 border-0 shadow-sm"
          >
            <Plus className="mr-2 h-4 w-4" />
            新增貨架
          </Button>
        </PermissionGate>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-gray-900">貨架列表</CardTitle>
          <CardDescription className="text-gray-700"> 
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error ? (
            <p className="text-red-600">載入貨架失敗：{(error as Error).message}</p>
          ) : (
            <EnhancedTable
              columns={columns}
              data={shelves || []}
              loading={isLoading}
              searchPlaceholder="搜尋貨架名稱..."
              emptyMessage="尚無貨架，點擊右上角「新增貨架」建立"
              onRowClick={(row: Shelf) => setOpenShelfId(row.id)}
            />
          )}
        </CardContent>
      </Card>

      <ShelfDialog
        shelf={shelves?.find((shelf) => shelf.id === openShelfId) ?? null}
        onOpenChange={(open) => !open && setOpenShelfId(null)}
        canEdit={canEdit}
        existingShelves={shelves || []}
      />
      <CreateShelfDialog
        open={isCreateDialogOpen}
        onOpenChange={setIsCreateDialogOpen}
        existingShelves={shelves || []}
      />
    </div>
  );
};
