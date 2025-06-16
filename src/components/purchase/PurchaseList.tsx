
import React, { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SearchInput } from '@/components/ui/search-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Eye, Edit, Filter } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { ViewPurchaseDialog } from './ViewPurchaseDialog';
import { EditPurchaseDialog } from './EditPurchaseDialog';
import { useDebounce } from '@/hooks/useDebounce';

export const PurchaseList = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'confirmed' | 'partial_arrived' | 'completed' | 'cancelled'>('all');
  const [selectedPurchase, setSelectedPurchase] = useState<any | null>(null);
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);

  // Debounce search term to improve performance
  const debouncedSearchTerm = useDebounce(searchTerm, 300);

  const { data: purchases, isLoading } = useQuery({
    queryKey: ['purchases', debouncedSearchTerm, statusFilter],
    queryFn: async () => {
      let query = supabase
        .from('purchase_orders')
        .select(`
          *,
          factories (name),
          purchase_order_items (
            id,
            ordered_quantity,
            ordered_rolls,
            unit_price,
            products_new (name, color)
          ),
          purchase_order_relations (
            orders (
              id,
              order_number,
              note
            )
          )
        `)
        .order('created_at', { ascending: false });

      if (statusFilter !== 'all') {
        query = query.eq('status', statusFilter);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data;
    }
  });

  // Filter purchases client-side for better performance
  const filteredPurchases = useMemo(() => {
    if (!purchases) return [];
    
    if (!debouncedSearchTerm) return purchases;
    
    return purchases.filter(purchase => {
      const searchLower = debouncedSearchTerm.toLowerCase();
      
      // 搜尋採購單號
      if (purchase.po_number?.toLowerCase().includes(searchLower)) return true;
      
      // 搜尋工廠名稱
      if (purchase.factories?.name?.toLowerCase().includes(searchLower)) return true;
      
      // 搜尋關聯訂單號
      const relatedOrders = purchase.purchase_order_relations?.map((rel: any) => rel.orders) || [];
      return relatedOrders.some((order: any) => 
        order?.order_number?.toLowerCase().includes(searchLower)
      );
    });
  }, [purchases, debouncedSearchTerm]);

  const getStatusBadge = (status: string) => {
    const statusMap = {
      pending: { label: '待確認', variant: 'secondary' as const },
      confirmed: { label: '已確認', variant: 'default' as const },
      partial_arrived: { label: '部分到貨', variant: 'outline' as const },
      completed: { label: '已完成', variant: 'default' as const },
      cancelled: { label: '已取消', variant: 'destructive' as const }
    };
    
    const config = statusMap[status as keyof typeof statusMap] || { label: status, variant: 'secondary' as const };
    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  const handleView = (purchase: any) => {
    setSelectedPurchase(purchase);
    setViewDialogOpen(true);
  };

  const handleEdit = (purchase: any) => {
    setSelectedPurchase(purchase);
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
              placeholder="搜尋採購單號、工廠名稱或訂單號..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            
            <Select value={statusFilter} onValueChange={(value: 'all' | 'pending' | 'confirmed' | 'partial_arrived' | 'completed' | 'cancelled') => setStatusFilter(value)}>
              <SelectTrigger className="border-gray-300 focus:border-blue-500 focus:ring-blue-500">
                <SelectValue placeholder="選擇狀態" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部狀態</SelectItem>
                <SelectItem value="pending">待確認</SelectItem>
                <SelectItem value="confirmed">已確認</SelectItem>
                <SelectItem value="partial_arrived">部分到貨</SelectItem>
                <SelectItem value="completed">已完成</SelectItem>
                <SelectItem value="cancelled">已取消</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* 採購單列表 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-gray-900">採購單列表</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-gray-900">採購單號</TableHead>
                  <TableHead className="text-gray-900">工廠</TableHead>
                  <TableHead className="text-gray-900">狀態</TableHead>
                  <TableHead className="text-gray-900">總數量</TableHead>
                  <TableHead className="text-gray-900">總金額</TableHead>
                  <TableHead className="text-gray-900">項目數</TableHead>
                  <TableHead className="text-gray-900">預計到貨</TableHead>
                  <TableHead className="text-gray-900">關聯訂單</TableHead>
                  <TableHead className="text-gray-900">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredPurchases?.map((purchase) => {
                  const totalAmount = purchase.purchase_order_items?.reduce(
                    (sum: number, item: any) => sum + (item.ordered_quantity * item.unit_price), 
                    0
                  ) || 0;
                  
                  const totalQuantity = purchase.purchase_order_items?.reduce(
                    (sum: number, item: any) => sum + item.ordered_quantity, 
                    0
                  ) || 0;

                  // 獲取關聯訂單
                  const relatedOrders = purchase.purchase_order_relations?.map((rel: any) => rel.orders) || [];

                  return (
                    <TableRow key={purchase.id}>
                      <TableCell className="font-medium text-gray-900">
                        {purchase.po_number}
                      </TableCell>
                      <TableCell className="text-gray-700">
                        {purchase.factories?.name}
                      </TableCell>
                      <TableCell>
                        {getStatusBadge(purchase.status)}
                      </TableCell>
                      <TableCell className="text-gray-700">
                        {totalQuantity.toFixed(2)} 公斤
                      </TableCell>
                      <TableCell className="text-gray-700">
                        ${totalAmount.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-gray-700">
                        {purchase.purchase_order_items?.length || 0}
                      </TableCell>
                      <TableCell className="text-gray-700">
                        {purchase.expected_arrival_date 
                          ? new Date(purchase.expected_arrival_date).toLocaleDateString('zh-TW')
                          : '未設定'
                        }
                      </TableCell>
                      <TableCell>
                        {relatedOrders.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {relatedOrders.map((order: any, index: number) => (
                              <Badge key={index} variant="outline" className="text-xs">
                                {order.order_number}
                              </Badge>
                            ))}
                          </div>
                        ) : (
                          <span className="text-gray-500">-</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleView(purchase)}
                            className="border-gray-300 text-gray-700 hover:bg-gray-50"
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleEdit(purchase)}
                            className="border-gray-300 text-gray-700 hover:bg-gray-50"
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          
          {filteredPurchases?.length === 0 && (
            <div className="text-center py-8 text-gray-500">
              沒有找到採購單
            </div>
          )}
        </CardContent>
      </Card>

      {/* 對話框 */}
      {selectedPurchase && (
        <>
          <ViewPurchaseDialog
            open={viewDialogOpen}
            onOpenChange={setViewDialogOpen}
            purchase={selectedPurchase}
          />
          <EditPurchaseDialog
            open={editDialogOpen}
            onOpenChange={setEditDialogOpen}
            purchase={selectedPurchase}
          />
        </>
      )}
    </div>
  );
};
