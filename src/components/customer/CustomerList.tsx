
import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { PartnerDialog } from '@/components/common/PartnerDialog';
import type { PartnerRow } from '@/lib/partnerForm';
import { EnhancedTable, TableColumn } from '@/components/ui/enhanced-table';
import { useCurrentOrganization } from '@/hooks/useCurrentOrganization';
import { usePermissions } from '@/hooks/usePermissions';
import { Badge } from '@/components/ui/badge';

export const CustomerList = () => {
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('canEditCustomers');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { organizationId, hasOrganization } = useCurrentOrganization();

  const { data: customers, isLoading } = useQuery({
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

  const handleView = (row: PartnerRow) => setSelectedId(row.id);

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

      <PartnerDialog
        kind="customer"
        partner={(customers ?? []).find((row) => row.id === selectedId) ?? null}
        open={selectedId !== null}
        onOpenChange={(open) => !open && setSelectedId(null)}
        canEdit={canEdit}
      />
    </div>
  );
};
