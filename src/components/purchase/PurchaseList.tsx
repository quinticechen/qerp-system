
import React, { useState, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SearchInput } from '@/components/ui/search-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Eye, Edit, Search, Filter } from 'lucide-react';
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
      <div className="grid gap-4">
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
            <Card key={purchase.id} className="hover:shadow-md transition-shadow">
              <CardContent className="p-6">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">{purchase.po_number}</h3>
                    <p className="text-gray-600">工廠：{purchase.factories?.name}</p>
                    {relatedOrders.length > 0 && (
                      <div className="mt-2">
                        <p className="text-gray-600 font-medium">關聯訂單：</p>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {relatedOrders.map((order: any, index: number) => (
                            <div key={index} className="flex items-center">
                              <Badge variant="outline" className="text-xs">
                                {order.order_number}
                              </Badge>
                              {order.note && (
                                <span className="text-xs text-gray-500 ml-1">({order.note})</span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="text-right">
                    {getStatusBadge(purchase.status)}
                    <p className="text-sm text-gray-500 mt-1">
                      {new Date(purchase.order_date).toLocaleDateString('zh-TW')}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                  <div>
                    <p className="text-sm text-gray-500">總數量</p>
                    <p className="font-medium text-gray-900">{totalQuantity.toFixed(2)} 公斤</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">總金額</p>
                    <p className="font-medium text-gray-900">${totalAmount.toFixed(2)}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">項目數</p>
                    <p className="font-medium text-gray-900">{purchase.purchase_order_items?.length || 0}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">預計到貨</p>
                    <p className="font-medium text-gray-900">
                      {purchase.expected_arrival_date 
                        ? new Date(purchase.expected_arrival_date).toLocaleDateString('zh-TW')
                        : '未設定'
                      }
                    </p>
                  </div>
                </div>

                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleView(purchase)}
                    className="border-gray-300 text-gray-700 hover:bg-gray-50"
                  >
                    <Eye className="h-4 w-4 mr-1" />
                    查看
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleEdit(purchase)}
                    className="border-gray-300 text-gray-700 hover:bg-gray-50"
                  >
                    <Edit className="h-4 w-4 mr-1" />
                    編輯
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}

        {filteredPurchases?.length === 0 && (
          <Card>
            <CardContent className="text-center py-8">
              <p className="text-gray-500">沒有找到採購單</p>
            </CardContent>
          </Card>
        )}
      </div>

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
