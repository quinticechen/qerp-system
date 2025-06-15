
import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search, Edit, Eye, Trash2 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { EditPurchaseDialog } from './EditPurchaseDialog';
import { ViewPurchaseDialog } from './ViewPurchaseDialog';

export const PurchaseList = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [editingPurchase, setEditingPurchase] = useState(null);
  const [viewingPurchase, setViewingPurchase] = useState(null);

  const { data: purchases, isLoading, error } = useQuery({
    queryKey: ['purchases'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('purchase_orders')
        .select(`
          *,
          factories:factory_id (
            id,
            name
          ),
          orders:order_id (
            id,
            order_number
          ),
          profiles:user_id (
            id,
            full_name
          )
        `)
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      return data;
    }
  });

  const getStatusBadge = (status) => {
    const statusMap = {
      pending: { label: '待確認', color: 'bg-yellow-100 text-yellow-800' },
      confirmed: { label: '已下單', color: 'bg-blue-100 text-blue-800' },
      partial_arrived: { label: '部分到貨', color: 'bg-orange-100 text-orange-800' },
      completed: { label: '已完成', color: 'bg-green-100 text-green-800' },
      cancelled: { label: '已取消', color: 'bg-red-100 text-red-800' }
    };
    
    const statusInfo = statusMap[status] || { label: status, color: 'bg-gray-100 text-gray-800' };
    return (
      <Badge className={`${statusInfo.color} border-0`}>
        {statusInfo.label}
      </Badge>
    );
  };

  const filteredPurchases = purchases?.filter(purchase => {
    const matchesSearch = 
      purchase.po_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
      purchase.factories?.name?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === 'all' || purchase.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="text-center text-gray-500">載入中...</div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="text-center text-red-600">載入採購單時發生錯誤</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-gray-900">採購單列表</CardTitle>
          <CardDescription className="text-gray-600">
            管理所有採購單，包括新增、編輯和查看詳情
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-4 mb-6">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
              <Input
                placeholder="搜尋採購單編號或工廠名稱..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 border-gray-300 focus:border-blue-500 focus:ring-blue-500"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-48 border-gray-300 focus:border-blue-500 focus:ring-blue-500">
                <SelectValue placeholder="篩選狀態" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">所有狀態</SelectItem>
                <SelectItem value="pending">待確認</SelectItem>
                <SelectItem value="confirmed">已下單</SelectItem>
                <SelectItem value="partial_arrived">部分到貨</SelectItem>
                <SelectItem value="completed">已完成</SelectItem>
                <SelectItem value="cancelled">已取消</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-3 px-4 font-semibold text-gray-900">採購單編號</th>
                  <th className="text-left py-3 px-4 font-semibold text-gray-900">工廠</th>
                  <th className="text-left py-3 px-4 font-semibold text-gray-900">關聯訂單</th>
                  <th className="text-left py-3 px-4 font-semibold text-gray-900">下單日期</th>
                  <th className="text-left py-3 px-4 font-semibold text-gray-900">預計到貨</th>
                  <th className="text-left py-3 px-4 font-semibold text-gray-900">狀態</th>
                  <th className="text-left py-3 px-4 font-semibold text-gray-900">負責人</th>
                  <th className="text-left py-3 px-4 font-semibold text-gray-900">操作</th>
                </tr>
              </thead>
              <tbody>
                {filteredPurchases?.map((purchase) => (
                  <tr key={purchase.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-3 px-4 text-gray-900">{purchase.po_number}</td>
                    <td className="py-3 px-4 text-gray-700">{purchase.factories?.name}</td>
                    <td className="py-3 px-4 text-gray-700">
                      {purchase.orders?.order_number || '-'}
                    </td>
                    <td className="py-3 px-4 text-gray-700">
                      {new Date(purchase.order_date).toLocaleDateString('zh-TW')}
                    </td>
                    <td className="py-3 px-4 text-gray-700">
                      {purchase.expected_arrival_date 
                        ? new Date(purchase.expected_arrival_date).toLocaleDateString('zh-TW')
                        : '-'}
                    </td>
                    <td className="py-3 px-4">{getStatusBadge(purchase.status)}</td>
                    <td className="py-3 px-4 text-gray-700">{purchase.profiles?.full_name}</td>
                    <td className="py-3 px-4">
                      <div className="flex gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setViewingPurchase(purchase)}
                          className="text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditingPurchase(purchase)}
                          className="text-green-600 hover:text-green-700 hover:bg-green-50"
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-red-600 hover:text-red-700 hover:bg-red-50"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {filteredPurchases?.length === 0 && (
            <div className="text-center py-8 text-gray-500">
              沒有找到符合條件的採購單
            </div>
          )}
        </CardContent>
      </Card>

      {editingPurchase && (
        <EditPurchaseDialog
          purchase={editingPurchase}
          open={!!editingPurchase}
          onOpenChange={(open) => !open && setEditingPurchase(null)}
        />
      )}

      {viewingPurchase && (
        <ViewPurchaseDialog
          purchase={viewingPurchase}
          open={!!viewingPurchase}
          onOpenChange={(open) => !open && setViewingPurchase(null)}
        />
      )}
    </>
  );
};
