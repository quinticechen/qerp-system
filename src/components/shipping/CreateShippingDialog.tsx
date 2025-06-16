
import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Check, ChevronsUpDown, Plus, Trash } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface CreateShippingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface OrderProduct {
  id: string;
  product_id: string;
  quantity: number;
  shipped_quantity: number;
  products_new: {
    name: string;
    color?: string;
    color_code?: string;
  };
}

interface ShippingRoll {
  inventory_roll_id: string;
  shipped_quantity: number;
}

interface ShippingItem {
  order_product_id: string;
  rolls: ShippingRoll[];
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
  const [selectedItems, setSelectedItems] = useState<ShippingItem[]>([]);
  
  // UI state for popovers
  const [customerOpen, setCustomerOpen] = useState(false);
  const [orderOpen, setOrderOpen] = useState(false);
  const [rollSelectors, setRollSelectors] = useState<{[key: string]: boolean}>({});

  // 獲取客戶
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

  // 獲取選中客戶的訂單
  const { data: orders } = useQuery({
    queryKey: ['orders', customerId],
    queryFn: async () => {
      if (!customerId) return [];
      
      const { data, error } = await supabase
        .from('orders')
        .select('id, order_number')
        .eq('customer_id', customerId)
        .in('shipping_status', ['not_started', 'partial_shipped'])
        .order('order_number');
      
      if (error) throw error;
      return data;
    },
    enabled: !!customerId
  });

  // 獲取選中訂單的產品項目
  const { data: orderProducts } = useQuery({
    queryKey: ['order-products', orderId],
    queryFn: async () => {
      if (!orderId) return [];
      
      const { data, error } = await supabase
        .from('order_products')
        .select(`
          id,
          product_id,
          quantity,
          shipped_quantity,
          products_new (name, color, color_code)
        `)
        .eq('order_id', orderId)
        .neq('status', 'shipped');
      
      if (error) throw error;
      return data as OrderProduct[];
    },
    enabled: !!orderId
  });

  // 獲取所有可用的庫存布卷（只有在有訂單產品時才查詢）
  const { data: availableRolls } = useQuery({
    queryKey: ['available-rolls', orderId],
    queryFn: async () => {
      if (!orderId || !orderProducts || orderProducts.length === 0) return [];
      
      const productIds = orderProducts.map(op => op.product_id);

      const { data, error } = await supabase
        .from('inventory_rolls')
        .select(`
          id,
          roll_number,
          current_quantity,
          quality,
          product_id,
          products_new (name, color, color_code)
        `)
        .in('product_id', productIds)
        .eq('is_allocated', false)
        .gt('current_quantity', 0)
        .order('roll_number');
      
      if (error) throw error;
      return data;
    },
    enabled: !!orderId && !!orderProducts && orderProducts.length > 0
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

      const allRolls = shippingData.items.flatMap(item => item.rolls);
      const totalShippedQuantity = allRolls.reduce((sum, roll) => sum + roll.shipped_quantity, 0);
      const totalShippedRolls = allRolls.length;

      const { data: shipping, error: shippingError } = await supabase
        .from('shippings')
        .insert({
          customer_id: shippingData.customer_id,
          order_id: shippingData.order_id,
          shipping_date: shippingData.shipping_date,
          total_shipped_quantity: totalShippedQuantity,
          total_shipped_rolls: totalShippedRolls,
          note: shippingData.note || null,
          user_id: user.id,
          shipping_number: ''
        } as any)
        .select()
        .single();

      if (shippingError) throw shippingError;

      const itemsToInsert = allRolls.map(roll => ({
        shipping_id: shipping.id,
        inventory_roll_id: roll.inventory_roll_id,
        shipped_quantity: roll.shipped_quantity
      }));

      const { error: itemsError } = await supabase
        .from('shipping_items')
        .insert(itemsToInsert);

      if (itemsError) throw itemsError;

      for (const roll of allRolls) {
        const inventoryRoll = availableRolls?.find(r => r.id === roll.inventory_roll_id);
        if (inventoryRoll) {
          const newQuantity = inventoryRoll.current_quantity - roll.shipped_quantity;
          
          const { error: updateError } = await supabase
            .from('inventory_rolls')
            .update({ 
              current_quantity: newQuantity,
              is_allocated: newQuantity <= 0
            })
            .eq('id', roll.inventory_roll_id);

          if (updateError) throw updateError;
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
      queryClient.invalidateQueries({ queryKey: ['orders'] });
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
    setSelectedItems([]);
    setRollSelectors({});
  };

  const toggleProductSelection = (orderProduct: OrderProduct, checked: boolean) => {
    if (checked) {
      const remainingQuantity = orderProduct.quantity - (orderProduct.shipped_quantity || 0);
      setSelectedItems(prev => [...prev, {
        order_product_id: orderProduct.id,
        rolls: [{
          inventory_roll_id: '',
          shipped_quantity: remainingQuantity
        }]
      }]);
    } else {
      setSelectedItems(prev => prev.filter(i => i.order_product_id !== orderProduct.id));
    }
  };

  const addRollToItem = (orderProductId: string) => {
    setSelectedItems(prev => prev.map(item => 
      item.order_product_id === orderProductId 
        ? { ...item, rolls: [...item.rolls, { inventory_roll_id: '', shipped_quantity: 0 }] }
        : item
    ));
  };

  const removeRollFromItem = (orderProductId: string, rollIndex: number) => {
    setSelectedItems(prev => prev.map(item => 
      item.order_product_id === orderProductId 
        ? { ...item, rolls: item.rolls.filter((_, index) => index !== rollIndex) }
        : item
    ));
  };

  const updateRollSelection = (orderProductId: string, rollIndex: number, rollId: string) => {
    setSelectedItems(prev => prev.map(item => 
      item.order_product_id === orderProductId 
        ? { 
            ...item, 
            rolls: item.rolls.map((roll, index) => 
              index === rollIndex ? { ...roll, inventory_roll_id: rollId } : roll
            )
          }
        : item
    ));
  };

  const updateRollQuantity = (orderProductId: string, rollIndex: number, quantity: number) => {
    setSelectedItems(prev => prev.map(item => 
      item.order_product_id === orderProductId 
        ? { 
            ...item, 
            rolls: item.rolls.map((roll, index) => 
              index === rollIndex ? { ...roll, shipped_quantity: quantity } : roll
            )
          }
        : item
    ));
  };

  const getAvailableRollsForProduct = (productId: string) => {
    return availableRolls?.filter(roll => roll.product_id === productId) || [];
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

    const validItems = selectedItems.filter(item => 
      item.rolls.some(roll => roll.inventory_roll_id && roll.shipped_quantity > 0)
    );

    if (validItems.length === 0) {
      toast({
        title: "錯誤",
        description: "請至少選擇一個有效的出貨項目",
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

  const selectedCustomer = customers?.find(c => c.id === customerId);
  const selectedOrder = orders?.find(o => o.id === orderId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-gray-900">新增出貨單</DialogTitle>
          <DialogDescription className="text-gray-700">
            選擇客戶訂單並確認要出貨的項目
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* 客戶選擇 */}
            <div className="space-y-2">
              <Label className="text-gray-800">客戶 *</Label>
              <Popover open={customerOpen} onOpenChange={setCustomerOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    className="w-full justify-between border-gray-300 text-gray-900 hover:bg-gray-50"
                  >
                    <span className="truncate">
                      {selectedCustomer ? selectedCustomer.name : "選擇客戶..."}
                    </span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0 bg-white shadow-lg border border-gray-200 z-50">
                  <Command>
                    <CommandInput placeholder="搜尋客戶..." className="h-9" />
                    <CommandList>
                      <CommandEmpty>未找到客戶。</CommandEmpty>
                      <CommandGroup>
                        {customers?.map((customer) => (
                          <CommandItem
                            key={customer.id}
                            value={customer.name}
                            onSelect={() => {
                              setCustomerId(customer.id);
                              setOrderId('');
                              setSelectedItems([]);
                              setCustomerOpen(false);
                            }}
                            className="cursor-pointer"
                          >
                            <span className="flex-1">{customer.name}</span>
                            <Check
                              className={cn(
                                "ml-auto h-4 w-4",
                                customerId === customer.id ? "opacity-100" : "opacity-0"
                              )}
                            />
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

            {/* 訂單選擇 */}
            <div className="space-y-2">
              <Label className="text-gray-800">訂單 *</Label>
              <Popover open={orderOpen} onOpenChange={setOrderOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    disabled={!customerId}
                    className="w-full justify-between border-gray-300 text-gray-900 hover:bg-gray-50 disabled:opacity-50"
                  >
                    <span className="truncate">
                      {selectedOrder ? selectedOrder.order_number : "選擇訂單..."}
                    </span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0 bg-white shadow-lg border border-gray-200 z-50">
                  <Command>
                    <CommandInput placeholder="搜尋訂單..." className="h-9" />
                    <CommandList>
                      <CommandEmpty>未找到訂單。</CommandEmpty>
                      <CommandGroup>
                        {orders?.map((order) => (
                          <CommandItem
                            key={order.id}
                            value={order.order_number}
                            onSelect={() => {
                              setOrderId(order.id);
                              setSelectedItems([]);
                              setOrderOpen(false);
                            }}
                            className="cursor-pointer"
                          >
                            <span className="flex-1">{order.order_number}</span>
                            <Check
                              className={cn(
                                "ml-auto h-4 w-4",
                                orderId === order.id ? "opacity-100" : "opacity-0"
                              )}
                            />
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-2">
              <Label className="text-gray-800">出貨日期 *</Label>
              <Input
                type="date"
                value={shippingDate}
                onChange={(e) => setShippingDate(e.target.value)}
                className="border-gray-300 text-gray-900 focus:border-blue-500 focus:ring-blue-500"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-gray-800">備註</Label>
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="輸入備註..."
                className="border-gray-300 text-gray-900 focus:border-blue-500 focus:ring-blue-500"
              />
            </div>
          </div>

          {orderProducts && orderProducts.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-gray-900">訂單項目</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {orderProducts.map((product) => {
                  const isSelected = selectedItems.some(si => si.order_product_id === product.id);
                  const selectedItem = selectedItems.find(si => si.order_product_id === product.id);
                  const remainingQuantity = product.quantity - (product.shipped_quantity || 0);
                  const availableRollsForProduct = getAvailableRollsForProduct(product.product_id);

                  return (
                    <div key={product.id} className="border border-gray-200 rounded p-4 space-y-3">
                      <div className="flex items-center space-x-3">
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={(checked) => toggleProductSelection(product, checked as boolean)}
                          className="border-gray-400 data-[state=checked]:bg-blue-600 data-[state=checked]:border-blue-600"
                        />
                        <div className="flex-1">
                          <div className="flex items-center space-x-3">
                            {product.products_new.color_code && (
                              <div 
                                className="w-6 h-6 rounded border border-gray-400 flex-shrink-0"
                                style={{ backgroundColor: product.products_new.color_code }}
                              />
                            )}
                            <div>
                              <h4 className="font-medium text-gray-900">
                                {product.products_new.name}
                              </h4>
                              <p className="text-sm text-gray-600">
                                {product.products_new.color && `顏色: ${product.products_new.color}`}
                                {product.products_new.color_code && ` (${product.products_new.color_code})`}
                              </p>
                            </div>
                          </div>
                          <p className="text-sm text-gray-600 mt-1">
                            訂單數量: {product.quantity}kg | 
                            已出貨: {product.shipped_quantity || 0}kg | 
                            待出貨: {remainingQuantity}kg
                          </p>
                          {!isSelected && availableRollsForProduct.length === 0 && (
                            <p className="text-sm text-red-600 mt-1">⚠️ 無庫存</p>
                          )}
                        </div>
                      </div>

                      {isSelected && selectedItem && (
                        <div className="pl-6 space-y-3">
                          <div className="flex justify-between items-center">
                            <Label className="text-gray-800">選擇布卷</Label>
                            {availableRollsForProduct.length > 0 && (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => addRollToItem(product.id)}
                                className="border-gray-300 text-gray-700 hover:bg-gray-50"
                              >
                                <Plus className="h-4 w-4 mr-2" />
                                新增布卷
                              </Button>
                            )}
                          </div>

                          {availableRollsForProduct.length === 0 ? (
                            <p className="text-sm text-red-600">⚠️ 此產品無庫存布卷可供出貨</p>
                          ) : (
                            selectedItem.rolls.map((roll, rollIndex) => {
                              const rollSelectorKey = `${product.id}-${rollIndex}`;
                              const selectedRoll = availableRollsForProduct.find(r => r.id === roll.inventory_roll_id);
                              const maxQuantity = selectedRoll ? selectedRoll.current_quantity : 0;
                              
                              return (
                                <div key={rollIndex} className="grid grid-cols-1 md:grid-cols-3 gap-4 p-3 border border-gray-100 rounded">
                                  <div className="space-y-2">
                                    <Label className="text-gray-800">選擇布卷</Label>
                                    <Popover 
                                      open={rollSelectors[rollSelectorKey] || false} 
                                      onOpenChange={(open) => setRollSelectors(prev => ({...prev, [rollSelectorKey]: open}))}
                                    >
                                      <PopoverTrigger asChild>
                                        <Button
                                          variant="outline"
                                          role="combobox"
                                          className="w-full justify-between border-gray-300 text-gray-900 hover:bg-gray-50"
                                        >
                                          <span className="truncate">
                                            {selectedRoll ? 
                                              `${selectedRoll.quality}級 ${selectedRoll.current_quantity}kg ${selectedRoll.roll_number}` 
                                              : "選擇布卷"
                                            }
                                          </span>
                                          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                        </Button>
                                      </PopoverTrigger>
                                      <PopoverContent className="w-[--radix-popover-trigger-width] p-0 bg-white shadow-lg border border-gray-200 z-50">
                                        <Command>
                                          <CommandInput placeholder="搜尋布卷..." className="h-9" />
                                          <CommandList>
                                            <CommandEmpty>未找到布卷。</CommandEmpty>
                                            <CommandGroup>
                                              {availableRollsForProduct.map((availableRoll) => (
                                                <CommandItem
                                                  key={availableRoll.id}
                                                  value={`${availableRoll.quality} ${availableRoll.current_quantity} ${availableRoll.roll_number}`}
                                                  onSelect={() => {
                                                    updateRollSelection(product.id, rollIndex, availableRoll.id);
                                                    setRollSelectors(prev => ({...prev, [rollSelectorKey]: false}));
                                                  }}
                                                  className="cursor-pointer"
                                                >
                                                  <div className="flex-1">
                                                    <div className="font-medium">
                                                      {availableRoll.quality}級 {availableRoll.current_quantity}kg {availableRoll.roll_number}
                                                    </div>
                                                  </div>
                                                  <Check
                                                    className={cn(
                                                      "ml-auto h-4 w-4",
                                                      roll.inventory_roll_id === availableRoll.id ? "opacity-100" : "opacity-0"
                                                    )}
                                                  />
                                                </CommandItem>
                                              ))}
                                            </CommandGroup>
                                          </CommandList>
                                        </Command>
                                      </PopoverContent>
                                    </Popover>
                                  </div>

                                  <div className="space-y-2">
                                    <Label className="text-gray-800">
                                      出貨數量 (公斤)
                                      {selectedRoll && (
                                        <span className="text-xs text-gray-500 ml-1">
                                          (最多 {selectedRoll.current_quantity}kg)
                                        </span>
                                      )}
                                    </Label>
                                    <Input
                                      type="number"
                                      step="0.01"
                                      min="0"
                                      max={maxQuantity}
                                      value={roll.shipped_quantity || 0}
                                      onChange={(e) => {
                                        const inputValue = parseFloat(e.target.value) || 0;
                                        const validValue = Math.min(inputValue, maxQuantity);
                                        updateRollQuantity(product.id, rollIndex, validValue);
                                      }}
                                      className="border-gray-300 text-gray-900 focus:border-blue-500 focus:ring-blue-500"
                                    />
                                    {roll.shipped_quantity > maxQuantity && (
                                      <p className="text-xs text-red-600">
                                        出貨數量不能超過布卷庫存 ({maxQuantity}kg)
                                      </p>
                                    )}
                                  </div>

                                  <div className="flex items-end">
                                    {selectedItem.rolls.length > 1 && (
                                      <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={() => removeRollFromItem(product.id, rollIndex)}
                                        className="text-red-600 hover:text-red-800 border-red-300 hover:bg-red-50"
                                      >
                                        <Trash className="h-4 w-4" />
                                      </Button>
                                    )}
                                  </div>
                                </div>
                              );
                            })
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}
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
