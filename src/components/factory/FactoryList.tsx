
import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { EditFactoryDialog } from './EditFactoryDialog';
import { ViewFactoryDialog } from './ViewFactoryDialog';
import { EnhancedTable, TableColumn } from '@/components/ui/enhanced-table';
import { useCurrentOrganization } from '@/hooks/useCurrentOrganization';
import { usePermissions } from '@/hooks/usePermissions';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { setPartnerActive } from '@/lib/api/partners';
import { apiErrorMessage } from '@/lib/api/client';

export const FactoryList = () => {
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('canEditFactories');
  const [selectedFactory, setSelectedFactory] = useState<any | null>(null);
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const { organizationId, hasOrganization } = useCurrentOrganization();

  const { data: factories, isLoading, refetch } = useQuery({
    queryKey: ['factories', organizationId],
    queryFn: async () => {
      if (!organizationId) {
        console.log('No organization ID available');
        return [];
      }

      console.log('Fetching factories for organization:', organizationId);
      const { data, error } = await supabase
        .from('factories')
        .select('*')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching factories:', error);
        throw error;
      }

      console.log('Fetched factories:', data);
      return data;
    },
    enabled: hasOrganization
  });

  // Disabled factorys stay on existing documents but are hidden from pickers for new ones
  const handleToggleActive = async () => {
    if (!organizationId || !selectedFactory) return;
    try {
      const nextActive = !selectedFactory.is_active;
      await setPartnerActive('factory', organizationId, selectedFactory.id, nextActive);
      toast.success(nextActive ? '工廠已啟用' : '工廠已停用');
      setSelectedFactory({ ...selectedFactory, is_active: nextActive });
      refetch();
    } catch (error) {
      toast.error(`變更工廠狀態失敗：${apiErrorMessage(error)}`);
    }
  };

  const handleView = (factory: any) => {
    setSelectedFactory(factory);
    setViewDialogOpen(true);
  };

  const columns: TableColumn[] = [
    {
      key: 'name',
      title: '工廠名稱',
      sortable: true,
      filterable: false,
      render: (value) => <span className="font-medium text-gray-900">{value}</span>
    },
    {
      key: 'contact_person',
      title: '聯絡人',
      sortable: true,
      filterable: false,
      render: (value) => <span className="text-gray-700">{value || '-'}</span>
    },
    {
      key: 'phone',
      title: '手機',
      sortable: true,
      filterable: false,
      render: (value) => <span className="text-gray-700">{value || '-'}</span>
    },
    {
      key: 'landline_phone',
      title: '市話',
      sortable: true,
      filterable: false,
      render: (value) => <span className="text-gray-700">{value || '-'}</span>
    },
    {
      key: 'fax',
      title: '傳真',
      sortable: true,
      filterable: false,
      render: (value) => <span className="text-gray-700">{value || '-'}</span>
    },
    {
      key: 'email',
      title: 'Email',
      sortable: true,
      filterable: false,
      render: (value) => <span className="text-gray-700">{value || '-'}</span>
    },
    {
      key: 'address',
      title: '地址',
      sortable: false,
      filterable: false,
      render: (value) => (
        <span className="text-gray-700 max-w-xs truncate block">
          {value || '-'}
        </span>
      )
    },
    {
      key: 'is_active',
      title: '狀態',
      sortable: true,
      filterable: true,
      filterOptions: [
        { value: 'true', label: '啟用' },
        { value: 'false', label: '停用' },
      ],
      render: (value) => (
        <Badge variant="outline" className={value ? 'bg-green-100 text-green-800 border-green-200' : 'bg-gray-100 text-gray-600 border-gray-200'}>
          {value ? '啟用' : '停用'}
        </Badge>
      )
    },
    {
      key: 'note',
      title: '備註',
      sortable: false,
      filterable: false,
      render: (value) => (
        <span className="text-gray-700 max-w-xs truncate block">
          {value || '-'}
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
          <CardTitle className="text-gray-900">工廠列表</CardTitle>
        </CardHeader>
        <CardContent>
          <EnhancedTable
            columns={columns}
            data={factories || []}
            loading={isLoading}
            searchPlaceholder="搜尋工廠名稱、聯絡人、電話..."
            emptyMessage="沒有找到工廠"
            onRowClick={handleView}
          />
        </CardContent>
      </Card>

      {/* 對話框 */}
      {selectedFactory && (
        <>
          <ViewFactoryDialog
            open={viewDialogOpen}
            onOpenChange={setViewDialogOpen}
            factory={selectedFactory}
            onToggleActive={canEdit ? handleToggleActive : undefined}
            onEdit={canEdit ? () => {
              setViewDialogOpen(false);
              setEditDialogOpen(true);
            } : undefined}
          />
          <EditFactoryDialog
            open={editDialogOpen}
            onOpenChange={setEditDialogOpen}
            factory={selectedFactory}
            onFactoryUpdated={refetch}
          />
        </>
      )}
    </div>
  );
};
