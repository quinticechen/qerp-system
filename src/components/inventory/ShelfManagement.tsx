import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { EnhancedTable, type TableColumn } from '@/components/ui/enhanced-table';
import { Pencil, Plus, Power, PowerOff, Warehouse } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { apiErrorMessage } from '@/lib/api/client';
import { useSetShelfActive, useShelves, type Shelf } from '@/hooks/useShelves';
import { CreateShelfDialog } from './CreateShelfDialog';
import { RenameShelfDialog } from './RenameShelfDialog';
import { ShelfProductsDialog } from './ShelfProductsDialog';
import { PermissionGate } from '@/components/PermissionGate';

export const ShelfManagement: React.FC = () => {
  const { data: shelves, isLoading, error } = useShelves();
  const [viewingShelf, setViewingShelf] = useState<Shelf | null>(null);
  const [renamingShelf, setRenamingShelf] = useState<Shelf | null>(null);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const { toast } = useToast();
  const setShelfActive = useSetShelfActive();

  // A disabled shelf keeps its rolls but cannot receive new ones
  const toggleActive = (shelf: Shelf) => {
    setShelfActive.mutate(
      { id: shelf.id, isActive: !shelf.isActive },
      {
        onSuccess: () =>
          toast({
            title: shelf.isActive ? '已停用貨架' : '已啟用貨架',
            description: shelf.isActive ? `「${shelf.name}」不能再放入新的布卷，現有布卷不受影響` : `「${shelf.name}」可以放入布卷`,
          }),
        onError: (error: Error) => toast({ title: '變更狀態失敗', description: apiErrorMessage(error), variant: 'destructive' }),
      },
    );
  };

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
    {
      key: 'actions',
      title: '操作',
      render: (_value: unknown, row: Shelf) => (
        <PermissionGate permission="canEditShelves">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`${row.isActive ? '停用' : '啟用'}貨架 ${row.name}`}
            title={row.isActive ? '停用貨架' : '啟用貨架'}
            disabled={setShelfActive.isPending}
            onClick={(e) => {
              e.stopPropagation();
              toggleActive(row);
            }}
            className="text-gray-600 hover:text-blue-700"
          >
            {row.isActive ? <PowerOff className="h-4 w-4" /> : <Power className="h-4 w-4" />}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`編輯貨架 ${row.name} 名稱`}
            title="編輯貨架名稱"
            onClick={(e) => {
              e.stopPropagation();
              setRenamingShelf(row);
            }}
            className="text-gray-600 hover:text-blue-700"
          >
            <Pencil className="h-4 w-4" />
          </Button>
        </PermissionGate>
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
              onRowClick={(row: Shelf) => setViewingShelf(row)}
            />
          )}
        </CardContent>
      </Card>

      <ShelfProductsDialog shelf={viewingShelf} onOpenChange={(open) => !open && setViewingShelf(null)} />
      <RenameShelfDialog shelf={renamingShelf} onOpenChange={(open) => !open && setRenamingShelf(null)} />
      <CreateShelfDialog
        open={isCreateDialogOpen}
        onOpenChange={setIsCreateDialogOpen}
        existingShelves={shelves || []}
      />
    </div>
  );
};
