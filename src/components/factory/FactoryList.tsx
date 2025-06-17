
import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Edit, Eye } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { EditFactoryDialog } from './EditFactoryDialog';
import { ViewFactoryDialog } from './ViewFactoryDialog';
import { EnhancedTable, TableColumn } from '@/components/ui/enhanced-table';
import { useCurrentOrganization } from '@/hooks/useCurrentOrganization';

export const FactoryList = () => {
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

  const handleView = (factory: any) => {
    setSelectedFactory(factory);
    setViewDialogOpen(true);
  };

  const handleEdit = (factory: any) => {
    setSelectedFactory(factory);
    setEditDialogOpen(true);
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
      title: '電話',
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
