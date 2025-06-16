
import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { SearchInput } from '@/components/ui/search-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Eye, Edit, Filter } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { ViewShippingDialog } from './ViewShippingDialog';
import { EditShippingDialog } from './EditShippingDialog';
import { useDebounce } from '@/hooks/useDebounce';

export const ShippingList = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [customerFilter, setCustomerFilter] = useState('all');
  const [selectedShipping, setSelectedShipping] = useState<any | null>(null);
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);

  // 使用防抖動，延遲 500ms
  const debouncedSearchTerm = useDebounce(searchTerm, 500);

  const { data: shippings, isLoading } = useQuery({
    queryKey: ['shippings', debouncedSearchTerm, customerFilter],
    queryFn: async () => {
      let query = supabase
        .from('shippings')
        .select(`
          *,
          customers (name),
          orders (order_number),
          shipping_items (
            id,
            shipped_quantity,
            inventory_rolls (
              roll_number,
              products_new (name, color)
            )
          )
        `)
        .order('created_at', { ascending: false });

      if (debouncedSearchTerm) {
        query = query.or(`shipping_number.ilike.%${debouncedSearchTerm}%,customers.name.ilike.%${debouncedSearchTerm}%`);
      }

      if (customerFilter !== 'all') {
        query = query.eq('customer_id', customerFilter);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data;
    }
  });

  const { data: customers } = useQuery({
    queryKey: ['customers'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('customers')
        .select('id, name')
        .order('name');
      
      if (error) throw error;
      return data;
    }
  });

  const handleView = (shipping: any) => {
    setSelectedShipping(shipping);
    setViewDialogOpen(true);
  };

  const handleEdit = (shipping: any) => {
    setSelectedShipping(shipping);
    setEditDialogOpen(true);
  };

  if (isLoading) {
    return <div className="text-center py-8 text-gray-500">載入中...</div>;
  }

  return (
    <div className="space-y-6">
      {/* 搜尋和篩選 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-gray-900">
            <Filter className="h-5 w-5" />
            篩選條件
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <SearchInput
              placeholder="搜尋出貨單號或客戶名稱..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            
            <Select value={customerFilter} onValueChange={setCustomerFilter}>
              <SelectTrigger className="border-gray-300 focus:border-blue-500 focus:ring-blue-500">
                <SelectValue placeholder="選擇客戶" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部客戶</SelectItem>
                {customers?.map((customer) => (
                  <SelectItem key={customer.id} value={customer.id}>
                    {customer.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* 出貨單列表 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-gray-900">出貨單列表</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-gray-900">出貨單號</TableHead>
                  <TableHead className="text-gray-900">客戶</TableHead>
                  <TableHead className="text-gray-900">關聯訂單</TableHead>
                  <TableHead className="text-gray-900">總重量</TableHead>
                  <TableHead className="text-gray-900">總卷數</TableHead>
                  <TableHead className="text-gray-900">項目數</TableHead>
                  <TableHead className="text-gray-900">出貨日期</TableHead>
                  <TableHead className="text-gray-900">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shippings?.map((shipping) => (
                  <TableRow key={shipping.id}>
                    <TableCell className="font-medium text-gray-900">
                      {shipping.shipping_number}
                    </TableCell>
                    <TableCell className="text-gray-700">
                      {shipping.customers?.name}
                    </TableCell>
                    <TableCell className="text-gray-700">
                      {shipping.orders?.order_number || '-'}
                    </TableCell>
                    <TableCell className="text-gray-700">
                      {shipping.total_shipped_quantity} 公斤
                    </TableCell>
                    <TableCell className="text-gray-700">
                      {shipping.total_shipped_rolls}
                    </TableCell>
                    <TableCell className="text-gray-700">
                      {shipping.shipping_items?.length || 0}
                    </TableCell>
                    <TableCell className="text-gray-700">
                      {new Date(shipping.shipping_date).toLocaleDateString('zh-TW')}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleView(shipping)}
                          className="border-gray-300 text-gray-700 hover:bg-gray-50"
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleEdit(shipping)}
                          className="border-gray-300 text-gray-700 hover:bg-gray-50"
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          
          {shippings?.length === 0 && (
            <div className="text-center py-8 text-gray-500">
              沒有找到出貨單
            </div>
          )}
        </CardContent>
      </Card>

      {/* 對話框 */}
      {selectedShipping && (
        <>
          <ViewShippingDialog
            open={viewDialogOpen}
            onOpenChange={setViewDialogOpen}
            shipping={selectedShipping}
          />
          <EditShippingDialog
            open={editDialogOpen}
            onOpenChange={setEditDialogOpen}
            shipping={selectedShipping}
          />
        </>
      )}
    </div>
  );
};
