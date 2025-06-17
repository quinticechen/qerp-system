
import React from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Edit, Eye } from 'lucide-react';
import { Product } from '@/hooks/useProducts';
import { EnhancedTable, TableColumn } from '@/components/ui/enhanced-table';

interface ProductListProps {
  products: Product[];
  loading: boolean;
  hasMore: boolean;
  searchTerm: string;
  categoryFilter: string;
  statusFilter: string;
  onSearch: (term: string) => void;
  onCategoryFilter: (category: string) => void;
  onStatusFilter: (status: string) => void;
  onLoadMore: () => void;
  onEdit: (product: Product) => void;
  canEdit?: boolean;
}

const ProductList: React.FC<ProductListProps> = ({
  products,
  loading,
  hasMore,
  searchTerm,
  categoryFilter,
  statusFilter,
  onSearch,
  onCategoryFilter,
  onStatusFilter,
  onLoadMore,
  onEdit,
  canEdit = false,
}) => {
  const getStatusBadgeClass = (status: string) => {
    switch (status) {
      case 'Available':
        return 'bg-green-100 text-green-800 border-green-200';
      case 'Discontinued':
        return 'bg-red-100 text-red-800 border-red-200';
      case 'Out_of_Stock':
        return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'Available':
        return '可用';
      case 'Discontinued':
        return '停產';
      case 'Out_of_Stock':
        return '缺貨';
      default:
        return status;
    }
  };

  const columns: TableColumn[] = [
    {
      key: 'name',
      title: '產品名稱',
      sortable: true,
      filterable: false,
      render: (value) => <span className="font-medium text-gray-900">{value}</span>
    },
    {
      key: 'category',
      title: '類別',
      sortable: true,
      filterable: true,
      filterOptions: [
        { value: '布料', label: '布料' },
        { value: '配件', label: '配件' },
        { value: '其他', label: '其他' }
      ],
      render: (value) => <span className="text-gray-700">{value}</span>
    },
    {
      key: 'color',
      title: '顏色',
      sortable: true,
      filterable: false,
      render: (value) => <span className="text-gray-700">{value || '-'}</span>
    },
    {
      key: 'color_code',
      title: '色號',
      sortable: true,
      filterable: false,
      render: (value) => <span className="text-gray-700">{value || '-'}</span>
    },
    {
      key: 'unit_of_measure',
      title: '單位',
      sortable: true,
      filterable: false,
      render: (value) => <span className="text-gray-700">{value}</span>
    },
    {
      key: 'stock_thresholds',
      title: '庫存閾值',
      sortable: true,
      filterable: false,
      render: (value) => <span className="text-gray-700">{value || '-'}</span>
    },
    {
      key: 'status',
      title: '狀態',
      sortable: true,
      filterable: true,
      filterOptions: [
        { value: 'Available', label: '可用' },
        { value: 'Discontinued', label: '停產' },
        { value: 'Out_of_Stock', label: '缺貨' }
      ],
      render: (value) => (
        <Badge variant="outline" className={getStatusBadgeClass(value)}>
          {getStatusText(value)}
        </Badge>
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
  ];

  // 只有在有編輯權限時才添加操作欄
  if (canEdit) {
    columns.push({
      key: 'actions',
      title: '操作',
      sortable: false,
      filterable: false,
      render: (value, row) => (
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onEdit(row)}
            className="border-gray-300 text-gray-700 hover:bg-gray-50"
          >
            <Edit className="h-4 w-4" />
          </Button>
        </div>
      )
    });
  }

  return (
    <EnhancedTable
      columns={columns}
      data={products}
      loading={loading}
      hasMore={hasMore}
      searchTerm={searchTerm}
      onSearch={onSearch}
      onLoadMore={onLoadMore}
      searchPlaceholder="搜尋產品名稱、顏色、色號..."
      emptyMessage="沒有找到產品"
    />
  );
};

export default ProductList;
