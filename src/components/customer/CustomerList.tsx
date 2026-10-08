
import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { EditCustomerDialog } from './EditCustomerDialog';
import { ViewCustomerDialog } from './ViewCustomerDialog';
import { EnhancedTable, TableColumn } from '@/components/ui/enhanced-table';
import { useCurrentOrganization } from '@/hooks/useCurrentOrganization';
import { usePermissions } from '@/hooks/usePermissions';

export const CustomerList = () => {
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('canEditCustomers');
  const [selectedCustomer, setSelectedCustomer] = useState<any | null>(null);
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const { organizationId, hasOrganization } = useCurrentOrganization();

  const { data: customers, isLoading, refetch } = useQuery({
    queryKey: ['customers', organizationId],
    queryFn: async () => {
      if (!organizationId) {
        console.log('No organization ID available');
        return [];
      }

      console.log('Fetching customers for organization:', organizationId);
      const { data, error } = await supabase
        .from('customers')
        .select('*')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching customers:', error);
        throw error;
      }

      console.log('Fetched customers:', data);
      return data;
    },
    enabled: hasOrganization
  });

  const handleView = (customer: any) => {
    setSelectedCustomer(customer);
    setViewDialogOpen(true);
  };

  const columns: TableColumn[] = [
    {
      key: 'name',
      title: '客戶名稱',
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
          <CardTitle className="text-gray-900">客戶列表</CardTitle>
        </CardHeader>
        <CardContent>
          <EnhancedTable
            columns={columns}
            data={customers || []}
            loading={isLoading}
            searchPlaceholder="搜尋客戶名稱、聯絡人、電話..."
            emptyMessage="沒有找到客戶"
            onRowClick={handleView}
          />
        </CardContent>
      </Card>

      {/* 對話框 */}
      {selectedCustomer && (
        <>
          <ViewCustomerDialog
            open={viewDialogOpen}
            onOpenChange={setViewDialogOpen}
            customer={selectedCustomer}
            onEdit={canEdit ? () => {
              setViewDialogOpen(false);
              setEditDialogOpen(true);
            } : undefined}
          />
          <EditCustomerDialog
            open={editDialogOpen}
            onOpenChange={setEditDialogOpen}
            customer={selectedCustomer}
            onCustomerUpdated={refetch}
          />
        </>
      )}
    </div>
  );
};
