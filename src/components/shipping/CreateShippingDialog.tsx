
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

interface CreateShippingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface ShippingItem {
  inventory_roll_id: string;
  shipped_quantity: number;
}

export const CreateShippingDialog: React.FC<CreateShippingDialogProps> = ({
  open,
  onOpenChange,
}) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [customerId, setCustomerId] = useState('');
  const [orderId, setOrderId] = useState('');
  const [shippingDate, setShippingDate] = useState(new Date().toISOString().split('T')[0]);
  const [note, setNote] = useState('');
  const [items, setItems] = useState<ShippingItem[]>([{
    inventory_roll_id: '',
    shipped_quantity: 0
  }]);

  // Fetch customers for selection
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

  // Fetch orders for selected customer
  const { data: orders } = useQuery({
    queryKey: ['orders', customerId],
    queryFn: async () => {
      if (!customerId) return [];
      
      const { data, error } = await supabase
        .from('orders')
        .select('id, order_number')
        .eq('customer_id', customerId)
        .order('order_number');
      
      if (error) throw error;
      return data;
    },
    enabled: !!customerId
  });

  // Fetch available inventory rolls
  const { data: inventoryRolls } = useQuery({
    queryKey: ['inventory-rolls'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inventory_rolls')
        .select(`
          id,
          roll_number,
          current_quantity,
          quality,
          products_new (name, color)
        `)
        .eq('is_allocated', false)
        .gt('current_quantity', 0)
        .order('roll_number');
      
      if (error) throw error;
      return data;
    }
  });

  const createShippingMutation = useMutation({
    mutationFn: async (shippingData: {
      customer_id: string;
      order_id: string;
      shipping_date: string;
      note?: string;
      items: ShippingItem[];
    }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      // Calculate totals
      const totalShippedQuantity = shippingData.items.reduce((sum, item) => sum + item.shipped_quantity, 0);
      const totalShippedRolls = shippingData.items.length;

      // Create shipping record
      const { data: shipping, error: shippingError } = await supabase
        .from('shippings')
        .insert({
          customer_id: shippingData.customer_id,
          order_id: shippingData.order_id,
          shipping_date: shippingData.shipping_date,
          total_shipped_quantity: totalShippedQuantity,
          total_shipped_rolls: totalShippedRolls,
          note: shippingData.note || null,
          user_id: user.id
        })
        .select()
        .single();

      if (shippingError) throw shippingError;

      // Create shipping items
      const itemsToInsert = shippingData.items.map(item => ({
        shipping_id: shipping.id,
        inventory_roll_id: item.inventory_roll_id,
        shipped_quantity: item.shipped_quantity
      }));

      const { error: itemsError } = await supabase
        .from('shipping_items')
        .insert(itemsToInsert);

      if (itemsError) throw itemsError;

      // Update inventory roll quantities
      for (const item of shippingData.items) {
        const roll = inventoryRolls?.find(r => r.id === item.inventory_roll_id);
        if (roll) {
          const newQuantity = roll.current_quantity - item.shipped_quantity;
          
          const { error: updateError } = await supabase
            .from('inventory_rolls')
            .update({ 
              current_quantity: newQuantity,
              is_allocated: newQuantity <= 0
            })
            .eq('id', item.inventory_roll_id);

          if (updateError) throw updateError;

          // Create shipment history record
          const { error: historyError } = await supabase
            .from('shipment_history')
            .insert({
              shipping_item_id: shipping.id,
              customer_id: shippingData.customer_id,
              product_id: roll.products_new?.id,
              quantity: item.shipped_quantity,
              date: shippingData.shipping_date
            });

          if (historyError) throw historyError;
        }
      }

      return shipping;
    },
    onSuccess: () => {
      toast({
        title: "成功",
        description: "出貨單已成功建立",
      });
      queryClient.invalidateQueries({ queryKey: ['shippings'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-rolls'] });
      onOpenChange(false);
      resetForm();
    },
    onError: (error) => {
      console.error('Error creating shipping:', error);
      toast({
        title: "錯誤",
        description: "建立出貨單時發生錯誤",
        variant: "destructive",
      });
    },
  });

  const resetForm = () => {
    setCustomerId('');
    setOrderId('');
    setShippingDate(new Date().toISOString().split('T')[0]);
    setNote('');
    setItems([{
      inventory_roll_id: '',
      shipped_quantity: 0
    }]);
  };

  const addItem = () => {
    setItems([...items, {
      inventory_roll_id: '',
      shipped_quantity: 0
    }]);
  };

  const removeItem = (index: number) => {
    if (items.length > 1) {
      setItems(items.filter((_, i) => i !== index));
    }
  };

  const updateItem = (index: number, field: keyof ShippingItem, value: any) => {
    const updatedItems = [...items];
    updatedItems[index] = { ...updatedItems[index], [field]: value };
    setItems(updatedItems);
  };

  const handleSubmit = () => {
    if (!customerId || !orderId) {
      toast({
        title: "錯誤",
        description: "請選擇客戶和訂單",
        variant: "destructive",
      });
      return;
    }

    const validItems = items.filter(item => 
      item.inventory_roll_id && item.shipped_quantity > 0
    );

    if (validItems.length === 0) {
      toast({
        title: "錯誤",
        description: "請至少新增一個有效的出貨項目",
        variant: "destructive",
      });
      return;
    }

    createShippingMutation.mutate({
      customer_id: customerId,
      order_id: orderId,
      shipping_date: shippingDate,
      note: note || undefined,
      items: validItems
    });
  };

  const getTotalQuantity = () => {
    return items.reduce((sum, item) => sum + (item.shipped_quantity || 0), 0);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-gray-900">新增出貨單</DialogTitle>
          <DialogDescription className="text-gray-700">
            建立新的出貨單並選擇要出貨的布卷
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Basic Information */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="customer" className="text-gray-800">客戶 *</Label>
              <Select value={customerId} onValueChange={setCustomerId}>
                <SelectTrigger className="border-gray-300 text-gray-900 focus:border-blue-500 focus:ring-blue-500">
                  <SelectValue placeholder="選擇客戶" />
                </SelectTrigger>
                <SelectContent>
                  {customers?.map((customer) => (
                    <SelectItem key={customer.id} value={customer.id}>
                      {customer.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="order" className="text-gray-800">訂單 *</Label>
              <Select value={orderId} onValueChange={setOrderId} disabled={!customerId}>
                <SelectTrigger className="border-gray-300 text-gray-900 focus:border-blue-500 focus:ring-blue-500">
                  <SelectValue placeholder="選擇訂單" />
                </SelectTrigger>
                <SelectContent>
                  {orders?.map((order) => (
                    <SelectItem key={order.id} value={order.id}>
                      {order.order_number}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="shipping_date" className="text-gray-800">出貨日期 *</Label>
              <Input
                id="shipping_date"
                type="date"
                value={shippingDate}
                onChange={(e) => setShippingDate(e.target.value)}
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
                出貨項目
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
              {items.map((item, index) => {
                const selectedRoll = inventoryRolls?.find(r => r.id === item.inventory_roll_id);
                
                return (
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

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label className="text-gray-800">布卷 *</Label>
                        <Select 
                          value={item.inventory_roll_id} 
                          onValueChange={(value) => updateItem(index, 'inventory_roll_id', value)}
                        >
                          <SelectTrigger className="border-gray-300 text-gray-900 focus:border-blue-500 focus:ring-blue-500">
                            <SelectValue placeholder="選擇布卷" />
                          </SelectTrigger>
                          <SelectContent>
                            {inventoryRolls?.map((roll) => (
                              <SelectItem key={roll.id} value={roll.id}>
                                {roll.roll_number} - {roll.products_new?.name} 
                                {roll.products_new?.color && ` (${roll.products_new.color})`}
                                - 庫存: {roll.current_quantity}kg - {roll.quality}級
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <Label className="text-gray-800">出貨重量 (公斤) *</Label>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          max={selectedRoll?.current_quantity || undefined}
                          value={item.shipped_quantity}
                          onChange={(e) => updateItem(index, 'shipped_quantity', parseFloat(e.target.value) || 0)}
                          className="border-gray-300 text-gray-900 focus:border-blue-500 focus:ring-blue-500"
                        />
                        {selectedRoll && (
                          <p className="text-xs text-gray-500">
                            可用庫存: {selectedRoll.current_quantity}kg
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}

              <div className="bg-gray-50 p-4 rounded">
                <div className="text-sm text-gray-700">
                  <strong>總計:</strong> {getTotalQuantity().toFixed(2)} 公斤 | {items.length} 項目
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="text-gray-700 border-gray-300 hover:bg-gray-50">
            取消
          </Button>
          <Button 
            onClick={handleSubmit}
            disabled={createShippingMutation.isPending}
            className="bg-blue-600 text-white hover:bg-blue-700"
          >
            {createShippingMutation.isPending ? '建立中...' : '建立出貨單'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
