
import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Plus, Trash2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface CreatePurchaseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface PurchaseItem {
  product_id: string;
  ordered_quantity: number;
  ordered_rolls: number;
  unit_price: number;
  specifications?: string;
}

export const CreatePurchaseDialog: React.FC<CreatePurchaseDialogProps> = ({
  open,
  onOpenChange,
}) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [factoryId, setFactoryId] = useState('');
  const [orderId, setOrderId] = useState('');
  const [expectedArrivalDate, setExpectedArrivalDate] = useState('');
  const [note, setNote] = useState('');
  const [items, setItems] = useState<PurchaseItem[]>([{
    product_id: '',
    ordered_quantity: 0,
    ordered_rolls: 0,
    unit_price: 0,
    specifications: ''
  }]);

  // Fetch factories for selection
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

  // Fetch orders for selection
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

  // Fetch products for selection
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
    mutationFn: async (purchaseData: {
      factory_id: string;
      order_id?: string;
      expected_arrival_date?: string;
      note?: string;
      items: PurchaseItem[];
    }) => {
      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      // Create purchase order
      const { data: purchase, error: purchaseError } = await supabase
        .from('purchase_orders')
        .insert({
          factory_id: purchaseData.factory_id,
          order_id: purchaseData.order_id || null,
          expected_arrival_date: purchaseData.expected_arrival_date || null,
          note: purchaseData.note || null,
          user_id: user.id
        })
        .select()
        .single();

      if (purchaseError) throw purchaseError;

      // Create purchase order items
      const itemsToInsert = purchaseData.items.map(item => ({
        purchase_order_id: purchase.id,
        product_id: item.product_id,
        ordered_quantity: item.ordered_quantity,
        ordered_rolls: item.ordered_rolls,
        unit_price: item.unit_price,
        specifications: item.specifications ? JSON.parse(item.specifications) : null
      }));

      const { error: itemsError } = await supabase
        .from('purchase_order_items')
        .insert(itemsToInsert);

      if (itemsError) throw itemsError;

      return purchase;
    },
    onSuccess: () => {
      toast({
        title: "成功",
        description: "採購單已成功建立",
      });
      queryClient.invalidateQueries({ queryKey: ['purchases'] });
      onOpenChange(false);
      resetForm();
    },
    onError: (error) => {
      console.error('Error creating purchase order:', error);
      toast({
        title: "錯誤",
        description: "建立採購單時發生錯誤",
        variant: "destructive",
      });
    },
  });

  const resetForm = () => {
    setFactoryId('');
    setOrderId('');
    setExpectedArrivalDate('');
    setNote('');
    setItems([{
      product_id: '',
      ordered_quantity: 0,
      ordered_rolls: 0,
      unit_price: 0,
      specifications: ''
    }]);
  };

  const addItem = () => {
    setItems([...items, {
      product_id: '',
      ordered_quantity: 0,
      ordered_rolls: 0,
      unit_price: 0,
      specifications: ''
    }]);
  };

  const removeItem = (index: number) => {
    if (items.length > 1) {
      setItems(items.filter((_, i) => i !== index));
    }
  };

  const updateItem = (index: number, field: keyof PurchaseItem, value: any) => {
    const updatedItems = [...items];
    updatedItems[index] = { ...updatedItems[index], [field]: value };
    setItems(updatedItems);
  };

  const handleSubmit = () => {
    if (!factoryId) {
      toast({
        title: "錯誤",
        description: "請選擇工廠",
        variant: "destructive",
      });
      return;
    }

    const validItems = items.filter(item => 
      item.product_id && 
      item.ordered_quantity > 0 && 
      item.unit_price > 0
    );

    if (validItems.length === 0) {
      toast({
        title: "錯誤",
        description: "請至少新增一個有效的產品項目",
        variant: "destructive",
      });
      return;
    }

    createPurchaseMutation.mutate({
      factory_id: factoryId,
      order_id: orderId || undefined,
      expected_arrival_date: expectedArrivalDate || undefined,
      note: note || undefined,
      items: validItems
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-gray-900">新增採購單</DialogTitle>
          <DialogDescription className="text-gray-700">
            建立新的採購單並添加產品項目
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Basic Information */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="factory" className="text-gray-800">工廠 *</Label>
              <Select value={factoryId} onValueChange={setFactoryId}>
                <SelectTrigger className="border-gray-300 text-gray-900 focus:border-blue-500 focus:ring-blue-500">
                  <SelectValue placeholder="選擇工廠" />
                </SelectTrigger>
                <SelectContent className="bg-white border border-gray-200">
                  {factories?.map((factory) => (
                    <SelectItem key={factory.id} value={factory.id} className="text-gray-900 hover:bg-gray-100">
                      {factory.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="order" className="text-gray-800">關聯訂單</Label>
              <Select value={orderId} onValueChange={setOrderId}>
                <SelectTrigger className="border-gray-300 text-gray-900 focus:border-blue-500 focus:ring-blue-500">
                  <SelectValue placeholder="選擇訂單（可選）" />
                </SelectTrigger>
                <SelectContent className="bg-white border border-gray-200">
                  {orders?.map((order) => (
                    <SelectItem key={order.id} value={order.id} className="text-gray-900 hover:bg-gray-100">
                      {order.order_number}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="arrival_date" className="text-gray-800">預計到貨日期</Label>
              <Input
                id="arrival_date"
                type="date"
                value={expectedArrivalDate}
                onChange={(e) => setExpectedArrivalDate(e.target.value)}
                className="border-gray-300 text-gray-900 focus:border-blue-500 focus:ring-blue-500"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="note" className="text-gray-800">備註</Label>
              <Textarea
                id="note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="輸入備註..."
                className="border-gray-300 text-gray-900 focus:border-blue-500 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Items Section */}
          <Card>
            <CardHeader>
              <CardTitle className="text-gray-900 flex items-center justify-between">
                產品項目
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addItem}
                  className="border-gray-300 text-gray-700 hover:bg-gray-50"
                >
                  <Plus className="h-4 w-4 mr-1" />
                  新增項目
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {items.map((item, index) => (
                <div key={index} className="border border-gray-200 rounded p-4 space-y-4">
                  <div className="flex justify-between items-center">
                    <h4 className="font-medium text-gray-900">項目 {index + 1}</h4>
                    {items.length > 1 && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => removeItem(index)}
                        className="border-red-300 text-red-700 hover:bg-red-50"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="space-y-2">
                      <Label className="text-gray-800">產品 *</Label>
                      <Select 
                        value={item.product_id} 
                        onValueChange={(value) => updateItem(index, 'product_id', value)}
                      >
                        <SelectTrigger className="border-gray-300 text-gray-900 focus:border-blue-500 focus:ring-blue-500">
                          <SelectValue placeholder="選擇產品" />
                        </SelectTrigger>
                        <SelectContent className="bg-white border border-gray-200">
                          {products?.map((product) => (
                            <SelectItem key={product.id} value={product.id} className="text-gray-900 hover:bg-gray-100">
                              {product.name} {product.color && `(${product.color})`}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label className="text-gray-800">訂購數量 (公斤) *</Label>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        value={item.ordered_quantity}
                        onChange={(e) => updateItem(index, 'ordered_quantity', parseFloat(e.target.value) || 0)}
                        className="border-gray-300 text-gray-900 focus:border-blue-500 focus:ring-blue-500"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label className="text-gray-800">訂購卷數</Label>
                      <Input
                        type="number"
                        min="0"
                        value={item.ordered_rolls}
                        onChange={(e) => updateItem(index, 'ordered_rolls', parseInt(e.target.value) || 0)}
                        className="border-gray-300 text-gray-900 focus:border-blue-500 focus:ring-blue-500"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label className="text-gray-800">單價 *</Label>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        value={item.unit_price}
                        onChange={(e) => updateItem(index, 'unit_price', parseFloat(e.target.value) || 0)}
                        className="border-gray-300 text-gray-900 focus:border-blue-500 focus:ring-blue-500"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-gray-800">規格說明</Label>
                    <Textarea
                      value={item.specifications}
                      onChange={(e) => updateItem(index, 'specifications', e.target.value)}
                      placeholder="輸入產品規格說明..."
                      className="border-gray-300 text-gray-900 focus:border-blue-500 focus:ring-blue-500"
                    />
                  </div>

                  <div className="text-sm text-gray-600">
                    小計: ${(item.ordered_quantity * item.unit_price).toFixed(2)}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="text-gray-700 border-gray-300 hover:bg-gray-50">
            取消
          </Button>
          <Button 
            onClick={handleSubmit}
            disabled={createPurchaseMutation.isPending}
            className="bg-blue-600 text-white hover:bg-blue-700"
          >
            {createPurchaseMutation.isPending ? '建立中...' : '建立採購單'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
