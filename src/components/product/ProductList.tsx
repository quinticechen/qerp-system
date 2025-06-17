
import React, { useState } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Edit } from 'lucide-react';
import { Product } from '@/hooks/useProducts';

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
}

const CATEGORIES = ['布料', '胚布', '紗線', '輔料'];

export const ProductList: React.FC<ProductListProps> = ({
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
}) => {
  const [localSearchTerm, setLocalSearchTerm] = useState(searchTerm);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSearch(localSearchTerm);
  };

  return (
    <div className="space-y-4">
      {/* 搜尋和篩選控制 */}
      <div className="flex flex-col md:flex-row gap-4 items-start md:items-end">
        <form onSubmit={handleSearchSubmit} className="flex-1">
          <Input
            placeholder="搜尋產品名稱、類別、顏色..."
            value={localSearchTerm}
            onChange={(e) => setLocalSearchTerm(e.target.value)}
            className="w-full"
          />
        </form>

        <div className="flex gap-2">
          <Select value={categoryFilter} onValueChange={onCategoryFilter}>
            <SelectTrigger className="w-32">
              <SelectValue placeholder="類別" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">所有類別</SelectItem>
              {CATEGORIES.map((category) => (
                <SelectItem key={category} value={category}>
                  {category}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={statusFilter} onValueChange={onStatusFilter}>
            <SelectTrigger className="w-32">
              <SelectValue placeholder="狀態" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">所有狀態</SelectItem>
              <SelectItem value="Available">可用</SelectItem>
              <SelectItem value="Unavailable">不可用</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* 產品表格 */}
      <div className="border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>產品名稱</TableHead>
              <TableHead>類別</TableHead>
              <TableHead>顏色</TableHead>
              <TableHead>色碼</TableHead>
              <TableHead>計量單位</TableHead>
              <TableHead>產品狀態</TableHead>
              <TableHead>庫存閾值</TableHead>
              <TableHead>操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {products.map((product) => (
              <TableRow key={product.id}>
                <TableCell className="font-medium">{product.name}</TableCell>
                <TableCell>{product.category}</TableCell>
                <TableCell>{product.color || '-'}</TableCell>
                <TableCell>
                  {product.color_code ? (
                    <div className="flex items-center space-x-2">
                      <div 
                        className="w-4 h-4 rounded border border-gray-300"
                        style={{ backgroundColor: product.color_code }}
                      />
                      <span className="text-sm">{product.color_code}</span>
                    </div>
                  ) : (
                    '-'
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex items-center space-x-2">
                    <span>{product.unit_of_measure}</span>
                    <Badge 
                      variant={product.status === 'Available' ? 'default' : 'secondary'}
                      className={product.status === 'Available' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}
                    >
                      {product.status === 'Available' ? '可用' : '不可用'}
                    </Badge>
                  </div>
                </TableCell>
                <TableCell>
                  {product.stock_thresholds ? `${product.stock_thresholds} ${product.unit_of_measure}` : '-'}
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onEdit(product)}
                  >
                    <Edit className="h-4 w-4" />
                  </Button>
                </TableCell>
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

      {products.length === 0 && !loading && (
        <div className="text-center py-8 text-gray-500">
          暫無產品資料
        </div>
      )}
    </div>
  );
};
