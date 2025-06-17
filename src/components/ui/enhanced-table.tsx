
import React, { useState, useMemo } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { ChevronDown, ChevronUp } from 'lucide-react';

export interface TableColumn {
  key: string;
  title: string;
  render?: (value: any, row: any) => React.ReactNode;
  sortable?: boolean;
  filterable?: boolean;
  filterOptions?: { value: string; label: string }[];
}

export interface EnhancedTableProps {
  columns: TableColumn[];
  data: any[];
  loading?: boolean;
  hasMore?: boolean;
  searchTerm?: string;
  onSearch?: (term: string) => void;
  onLoadMore?: () => void;
  onSort?: (column: string, direction: 'asc' | 'desc') => void;
  onFilter?: (column: string, value: string) => void;
  searchPlaceholder?: string;
  emptyMessage?: string;
}

export const EnhancedTable: React.FC<EnhancedTableProps> = ({
  columns,
  data,
  loading = false,
  hasMore = false,
  searchTerm = '',
  onSearch,
  onLoadMore,
  onSort,
  onFilter,
  searchPlaceholder = '搜尋...',
  emptyMessage = '暫無資料'
}) => {
  const [localSearchTerm, setLocalSearchTerm] = useState(searchTerm);
  const [sortColumn, setSortColumn] = useState<string>('');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [filters, setFilters] = useState<Record<string, string>>({});

  // 本地排序和篩選邏輯
  const processedData = useMemo(() => {
    let result = [...data];

    // 應用篩選
    Object.entries(filters).forEach(([column, value]) => {
      if (value && value !== 'all') {
        result = result.filter(row => {
          const cellValue = row[column];
          if (typeof cellValue === 'boolean') {
            return cellValue.toString() === value;
          }
          if (Array.isArray(cellValue)) {
            return cellValue.some(item => 
              typeof item === 'object' && item.role ? item.role === value : item === value
            );
          }
          return cellValue?.toString().toLowerCase().includes(value.toLowerCase());
        });
      }
    });

    // 應用搜尋
    if (localSearchTerm) {
      result = result.filter(row => 
        Object.values(row).some(value => 
          value?.toString().toLowerCase().includes(localSearchTerm.toLowerCase())
        )
      );
    }

    // 應用排序
    if (sortColumn) {
      result.sort((a, b) => {
        let aValue = a[sortColumn];
        let bValue = b[sortColumn];

        // 處理特殊資料類型
        if (typeof aValue === 'boolean') {
          aValue = aValue ? 1 : 0;
          bValue = bValue ? 1 : 0;
        } else if (aValue instanceof Date) {
          aValue = aValue.getTime();
          bValue = bValue.getTime();
        } else if (typeof aValue === 'string') {
          aValue = aValue.toLowerCase();
          bValue = bValue.toLowerCase();
        }

        if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
        if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
        return 0;
      });
    }

    return result;
  }, [data, filters, localSearchTerm, sortColumn, sortDirection]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSearch?.(localSearchTerm);
  };

  const handleSort = (column: string) => {
    const newDirection = sortColumn === column && sortDirection === 'asc' ? 'desc' : 'asc';
    setSortColumn(column);
    setSortDirection(newDirection);
    onSort?.(column, newDirection);
  };

  const handleFilter = (column: string, value: string) => {
    const newFilters = { ...filters, [column]: value };
    setFilters(newFilters);
    onFilter?.(column, value);
  };

  return (
    <div className="space-y-4">
      {/* 搜尋和篩選控制 */}
      <div className="flex flex-col md:flex-row gap-4 items-start md:items-end">
        <form onSubmit={handleSearchSubmit} className="flex-1">
          <Input
            placeholder={searchPlaceholder}
            value={localSearchTerm}
            onChange={(e) => setLocalSearchTerm(e.target.value)}
            className="w-full"
          />
        </form>

        <div className="flex gap-2 flex-wrap">
          {columns.filter(col => col.filterable).map((column) => (
            <Select
              key={column.key}
              value={filters[column.key] || 'all'}
              onValueChange={(value) => handleFilter(column.key, value)}
            >
              <SelectTrigger className="w-32">
                <SelectValue placeholder={column.title} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">所有{column.title}</SelectItem>
                {column.filterOptions?.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ))}
        </div>
      </div>

      {/* 表格 */}
      <div className="border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((column) => (
                <TableHead key={column.key}>
                  <div className="flex items-center space-x-1">
                    <span>{column.title}</span>
                    {column.sortable && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-4 w-4 p-0"
                        onClick={() => handleSort(column.key)}
                      >
                        {sortColumn === column.key ? (
                          sortDirection === 'asc' ? (
                            <ChevronUp className="h-3 w-3" />
                          ) : (
                            <ChevronDown className="h-3 w-3" />
                          )
                        ) : (
                          <ChevronDown className="h-3 w-3 opacity-50" />
                        )}
                      </Button>
                    )}
                  </div>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {processedData.map((row, index) => (
              <TableRow key={index}>
                {columns.map((column) => (
                  <TableCell key={column.key}>
                    {column.render ? column.render(row[column.key], row) : row[column.key]}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* 載入更多按鈕 */}
      {hasMore && (
        <div className="flex justify-center pt-4">
          <Button 
            variant="outline" 
            onClick={onLoadMore}
            disabled={loading}
          >
            {loading ? '載入中...' : '載入更多'}
          </Button>
        </div>
      )}

      {processedData.length === 0 && !loading && (
        <div className="text-center py-8 text-gray-500">
          {emptyMessage}
        </div>
      )}
    </div>
  );
};
