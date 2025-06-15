
import React, { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2 } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface CreatePurchaseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface PurchaseItem {
  product_id: string;
  specifications: string;
  ordered_quantity: number;
  ordered_rolls: number;
  unit_price: number;
}

export const CreatePurchaseDialog = ({ open, onOpenChange }: CreatePurchaseDialogProps) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [formData, setFormData] = useState({
    factory_id: '',
    order_id: '',
    expected_arrival_date: '',
    note: ''
  });
  
  const [purchaseItems, setPurchaseItems] = useState<PurchaseItem[]>([
    {
      product_id: '',
      specifications: '',
      ordered_quantity: 0,
      ordered_rolls: 0,
      unit_price: 0
    }
  ]);

  // 獲取工廠列表
  const { data: factories } = useQuery({
    queryKey: ['factories'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('factories')
        .select('id, name')
        .order('name');
      if (error) throw error;
      return data;
    }
  });

  // 獲取訂單列表
  const { data: orders } = useQuery({
    queryKey: ['orders'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        .select('id, order_number')
        .order('order_number');
      if (error) throw error;
      return data;
    }
  });

  // 獲取產品列表
  const { data: products } = useQuery({
    queryKey: ['products'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products_new')
        .select('id, name, color')
        .order('name');
      if (error) throw error;
      return data;
    }
  });

  const createPurchaseMutation = useMutation({
    mutationFn: async () => {
      // 生成採購單編號
      const now = new Date();
      const poNumber = `PO${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
      
      // 獲取當前用戶
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('未找到用戶');

      // 創建採購單
      const purchaseData = {
        po_number: poNumber,
        factory_id: formData.factory_id,
        order_id: formData.order_id || null,
        expected_arrival_date: formData.expected_arrival_date || null,
        note: formData.note || null,
        user_id: user.id,
        order_date: new Date().toISOString().split('T')[0]
      };

      const { data: purchase, error: purchaseError } = await supabase
        .from('purchase_orders')
        .insert(purchaseData)
        .select()
        .single();

      if (purchaseError) throw purchaseError;

      // 創建採購項目
      const itemsData = purchaseItems
        .filter(item => item.product_id && item.ordered_quantity > 0 && item.unit_price > 0)
        .map(item => ({
          purchase_order_id: purchase.id,
          product_id: item.product_id,
          specifications: item.specifications ? JSON.stringify({ specifications: item.specifications }) : null,
          ordered_quantity: item.ordered_quantity,
          ordered_rolls: item.ordered_rolls || null,
          unit_price: item.unit_price
        }));

      if (itemsData.length === 0) {
        throw new Error('請至少添加一個有效的採購項目');
      }

      const { error: itemsError } = await supabase
        .from('purchase_order_items')
        .insert(itemsData);

      if (itemsError) throw itemsError;

      return purchase;
    },
    onSuccess: () => {
      toast({
        title: "成功",
        description: "採購單已建立"
      });
      queryClient.invalidateQueries({ queryKey: ['purchases'] });
      onOpenChange(false);
      // 重置表單
      setFormData({
        factory_id: '',
        order_id: '',
        expected_arrival_date: '',
        note: ''
      });
      setPurchaseItems([{
        product_id: '',
        specifications: '',
        ordered_quantity: 0,
        ordered_rolls: 0,
        unit_price: 0
      }]);
    },
    onError: (error) => {
      toast({
        title: "錯誤",
        description: "建立採購單失敗",
        variant: "destructive"
      });
      console.error('Error creating purchase:', error);
    }
  });

  const addPurchaseItem = () => {
    setPurchaseItems([...purchaseItems, {
      product_id: '',
      specifications: '',
      ordered_quantity: 0,
      ordered_rolls: 0,
      unit_price: 0
    }]);
  };

  const removePurchaseItem = (index: number) => {
    if (purchaseItems.length > 1) {
      setPurchaseItems(purchaseItems.filter((_, i) => i !== index));
    }
  };

  const updatePurchaseItem = (index: number, field: keyof PurchaseItem, value: any) => {
    const updatedItems = [...purchaseItems];
    updatedItems[index] = { ...updatedItems[index], [field]: value };
    setPurchaseItems(updatedItems);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    // 驗證必填欄位
    if (!formData.factory_id) {
      toast({
        title: "錯誤",
        description: "請選擇工廠",
        variant: "destructive"
      });
      return;
    }

    const validItems = purchaseItems.filter(item => 
      item.product_id && item.ordered_quantity > 0 && item.unit_price > 0
    );

    if (validItems.length === 0) {
      toast({
        title: "錯誤",
        description: "請至少添加一個有效的採購項目",
        variant: "destructive"
      });
      return;
    }

    createPurchaseMutation.mutate();
  };

  const totalAmount = purchaseItems.reduce((total, item) => total + (item.ordered_quantity * item.unit_price), 0);
  const totalQuantity = purchaseItems.reduce((total, item) => total + (item.ordered_quantity || 0), 0);

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-gray-900">新增採購單</DialogTitle>
          <DialogDescription className="text-gray-600">
            建立新的採購單，向工廠下達採購需求
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="factory" className="text-gray-700">工廠 *</Label>
              <Select value={formData.factory_id} onValueChange={(value) => setFormData({...formData, factory_id: value})}>
                <SelectTrigger className="border-gray-300 focus:border-blue-500 focus:ring-blue-500">
                  <SelectValue placeholder="選擇工廠" />
                </SelectTrigger>
                <SelectContent>
                  {factories?.map((factory) => (
                    <SelectItem key={factory.id} value={factory.id}>
                      {factory.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="order" className="text-gray-700">關聯訂單 (可選)</Label>
              <Select value={formData.order_id} onValueChange={(value) => setFormData({...formData, order_id: value})}>
                <SelectTrigger className="border-gray-300 focus:border-blue-500 focus:ring-blue-500">
                  <SelectValue placeholder="選擇訂單" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">不關聯訂單</SelectItem>
                  {orders?.map((order) => (
                    <SelectItem key={order.id} value={order.id}>
                      {order.order_number}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="expected_arrival_date" className="text-gray-700">預計到貨日期</Label>
              <Input
                id="expected_arrival_date"
                type="date"
                value={formData.expected_arrival_date}
                onChange={(e) => setFormData({...formData, expected_arrival_date: e.target.value})}
                className="border-gray-300 focus:border-blue-500 focus:ring-blue-500"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="note" className="text-gray-700">備註</Label>
            <Textarea
              id="note"
              placeholder="輸入備註..."
              value={formData.note}
              onChange={(e) => setFormData({...formData, note: e.target.value})}
              className="border-gray-300 focus:border-blue-500 focus:ring-blue-500"
            />
          </div>

          {/* 統計資訊 */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="font-medium text-blue-900">總數量：</span>
                <span className="text-blue-800">{totalQuantity.toFixed(2)} 公斤</span>
              </div>
              <div>
                <span className="font-medium text-blue-900">總金額：</span>
                <span className="text-blue-800">${totalAmount.toFixed(2)}</span>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <Label className="text-lg font-semibold text-gray-900">採購項目</Label>
              <Button
                type="button"
                onClick={addPurchaseItem}
                variant="outline"
                size="sm"
                className="border-gray-300 text-gray-700 hover:bg-gray-50"
              >
                <Plus className="h-4 w-4 mr-1" />
                添加項目
              </Button>
            </div>

            {purchaseItems.map((item, index) => (
              <div key={index} className="border border-gray-200 rounded-lg p-4 space-y-4">
                <div className="flex justify-between items-center">
                  <span className="font-medium text-gray-900">項目 {index + 1}</span>
                  {purchaseItems.length > 1 && (
                    <Button
                      type="button"
                      onClick={() => removePurchaseItem(index)}
                      variant="ghost"
                      size="sm"
                      className="text-red-600 hover:text-red-700 hover:bg-red-50"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-gray-700">產品 *</Label>
                    <Select 
                      value={item.product_id} 
                      onValueChange={(value) => updatePurchaseItem(index, 'product_id', value)}
                    >
                      <SelectTrigger className="border-gray-300 focus:border-blue-500 focus:ring-blue-500">
                        <SelectValue placeholder="選擇產品" />
                      </SelectTrigger>
                      <SelectContent>
                        {products?.map((product) => (
                          <SelectItem key={product.id} value={product.id}>
                            {product.name} {product.color && `- ${product.color}`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-gray-700">規格</Label>
                    <Input
                      placeholder="輸入採購規格..."
                      value={item.specifications}
                      onChange={(e) => updatePurchaseItem(index, 'specifications', e.target.value)}
                      className="border-gray-300 focus:border-blue-500 focus:ring-blue-500"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label className="text-gray-700">數量 (公斤) *</Label>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="0.00"
                      value={item.ordered_quantity || ''}
                      onChange={(e) => updatePurchaseItem(index, 'ordered_quantity', parseFloat(e.target.value) || 0)}
                      className="border-gray-300 focus:border-blue-500 focus:ring-blue-500"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label className="text-gray-700">卷數</Label>
                    <Input
                      type="number"
                      min="0"
                      placeholder="0"
                      value={item.ordered_rolls || ''}
                      onChange={(e) => updatePurchaseItem(index, 'ordered_rolls', parseInt(e.target.value) || 0)}
                      className="border-gray-300 focus:border-blue-500 focus:ring-blue-500"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label className="text-gray-700">單價 (每公斤) *</Label>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="0.00"
                      value={item.unit_price || ''}
                      onChange={(e) => updatePurchaseItem(index, 'unit_price', parseFloat(e.target.value) || 0)}
                      className="border-gray-300 focus:border-blue-500 focus:ring-blue-500"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label className="text-gray-700">小計</Label>
                    <div className="p-2 bg-gray-50 rounded border text-gray-900">
                      ${(item.ordered_quantity * item.unit_price).toFixed(2)}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="border-gray-300 text-gray-700 hover:bg-gray-50"
            >
              取消
            </Button>
            <Button
              type="submit"
              disabled={createPurchaseMutation.isPending}
              className="bg-blue-600 text-white hover:bg-blue-700"
            >
              {createPurchaseMutation.isPending ? '建立中...' : '建立採購單'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
