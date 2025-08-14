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
import { ScrollArea } from '@/components/ui/scroll-area';
import { useCurrentOrganization } from '@/hooks/useCurrentOrganization';

interface CreateShippingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: (shipping: any) => void;
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
  onSuccess,
}) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { organizationId } = useCurrentOrganization();
  
  const [customerId, setCustomerId] = useState('');
  const [orderId, setOrderId] = useState('');
  const [shippingDate, setShippingDate] = useState(new Date().toISOString().split('T')[0]);
  const [note, setNote] = useState('');
  const [selectedItems, setSelectedItems] = useState<ShippingItem[]>([]);
  
  // UI state for popovers
  const [customerOpen, setCustomerOpen] = useState(false);
  const [orderOpen, setOrderOpen] = useState(false);
  const [rollSelectors, setRollSelectors] = useState<{[key: string]: boolean}>({});
  
  // Validation errors
  const [validationErrors, setValidationErrors] = useState<{
    customerId?: string;
    orderId?: string;
    selectedItems?: string;
    shippingItems?: { [key: string]: { rolls?: string; quantities?: string } };
  }>({});

  // 獲取客戶
  const { data: customers } = useQuery({
    queryKey: ['customers', organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('customers')
        .select('id, name')
        .eq('organization_id', organizationId)
        .order('name');
      
      if (error) throw error;
      return data;
    },
    enabled: !!organizationId
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

  // 生成唯一的出貨單號
  const generateUniqueShippingNumber = async () => {
    const now = new Date();
    const year = now.getFullYear().toString().slice(-2);
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const day = now.getDate().toString().padStart(2, '0');
    const baseNumber = `SHIP-${year}${month}${day}`;
    
    // 查詢今天已有的出貨單號
    const { data: existingShippings } = await supabase
      .from('shippings')
      .select('shipping_number')
      .like('shipping_number', `${baseNumber}%`)
      .order('shipping_number', { ascending: false });
    
    let sequence = 1;
    if (existingShippings && existingShippings.length > 0) {
      const lastNumber = existingShippings[0].shipping_number;
      const lastSequence = parseInt(lastNumber.split('-').pop() || '0');
      sequence = lastSequence + 1;
    }
    
    return `${baseNumber}-${sequence.toString().padStart(3, '0')}`;
  };

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

      // 生成唯一的出貨單號
      const uniqueShippingNumber = await generateUniqueShippingNumber();

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
          shipping_number: uniqueShippingNumber
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
    onSuccess: (shipping) => {
      toast({
        title: "成功",
        description: "出貨單已成功建立",
      });
      queryClient.invalidateQueries({ queryKey: ['shippings'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-rolls'] });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      onOpenChange(false);
      resetForm();
      
      // 調用成功回調來打開新創建的出貨單預覽
      if (onSuccess) {
        onSuccess(shipping);
      }
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

  const getProductStockInfo = (productId: string) => {
    const productRolls = getAvailableRollsForProduct(productId);
    const totalStock = productRolls.reduce((sum, roll) => sum + roll.current_quantity, 0);
    const totalRolls = productRolls.length;
    return { totalStock, totalRolls };
  };

  const handleSubmit = () => {
    const errors: typeof validationErrors = {};
    const shippingItemErrors: { [key: string]: { rolls?: string; quantities?: string } } = {};
    
    if (!customerId) {
      errors.customerId = "請選擇客戶";
    }
    
    if (!orderId) {
      errors.orderId = "請選擇訂單";
    }

    // 檢查是否有選擇任何產品
    if (selectedItems.length === 0) {
      errors.selectedItems = "請至少選擇一個產品進行出貨";
      setValidationErrors({ ...errors, shippingItems: shippingItemErrors });
      return;
    }

    // 詳細驗證每個選擇的項目
    let hasValidItems = false;
    selectedItems.forEach((item, index) => {
      const itemErrors: { rolls?: string; quantities?: string } = {};
      
      // 檢查是否有選擇卷數
      const validRolls = item.rolls.filter(roll => roll.inventory_roll_id);
      if (validRolls.length === 0) {
        itemErrors.rolls = "請至少選擇一卷布料";
      }
      
      // 檢查每個卷數是否有輸入出貨數量
      const hasValidQuantities = item.rolls.some(roll => 
        roll.inventory_roll_id && roll.shipped_quantity > 0
      );
      
      if (validRolls.length > 0 && !hasValidQuantities) {
        itemErrors.quantities = "請輸入出貨數量";
      }
      
      if (Object.keys(itemErrors).length > 0) {
        shippingItemErrors[item.order_product_id] = itemErrors;
      } else {
        hasValidItems = true;
      }
    });

    if (!hasValidItems) {
      errors.selectedItems = "請確保至少有一個產品選擇了卷數並輸入了出貨數量";
    }

    if (Object.keys(errors).length > 0 || Object.keys(shippingItemErrors).length > 0) {
      setValidationErrors({ ...errors, shippingItems: shippingItemErrors });
      return;
    }

    // 只包含有效的項目
    const validItems = selectedItems.filter(item => 
      item.rolls.some(roll => roll.inventory_roll_id && roll.shipped_quantity > 0)
    );

    setValidationErrors({});
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
                    className={cn(
                      "w-full justify-between border-gray-300 text-gray-900 hover:bg-gray-50",
                      validationErrors.customerId && "border-red-500"
                    )}
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
                              setValidationErrors(prev => ({ ...prev, customerId: undefined }));
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
              {validationErrors.customerId && (
                <p className="text-sm text-red-600">{validationErrors.customerId}</p>
              )}
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
                    className={cn(
                      "w-full justify-between border-gray-300 text-gray-900 hover:bg-gray-50 disabled:opacity-50",
                      validationErrors.orderId && "border-red-500"
                    )}
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
                              setValidationErrors(prev => ({ ...prev, orderId: undefined }));
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
              {validationErrors.orderId && (
                <p className="text-sm text-red-600">{validationErrors.orderId}</p>
              )}
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
                  const { totalStock, totalRolls } = getProductStockInfo(product.product_id);

                  return (
                    <div key={product.id} className="border border-gray-200 rounded p-4 space-y-3">
                      <div className="flex items-center space-x-3">
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={(checked) => toggleProductSelection(product, checked as boolean)}
                          className="border-gray-400 data-[state=checked]:bg-blue-600 data-[state=checked]:border-blue-600"
                        />
                          <div className="flex-1">
                            <div>
                              <h4 className="font-medium text-gray-900">
                                {product.products_new.name}
                              </h4>
                              <p className="text-sm text-gray-600">
                                {product.products_new.color && `顏色: ${product.products_new.color}`}
                                {product.products_new.color_code && ` (${product.products_new.color_code})`}
                              </p>
                            </div>
                          <p className="text-sm text-gray-600 mt-1">
                            訂單數量: {product.quantity}kg | 
                            已出貨: {product.shipped_quantity || 0}kg | 
                            待出貨: {remainingQuantity}kg
                          </p>
                          <p className="text-sm text-blue-600 mt-1">
                            庫存: {totalStock}kg ({totalRolls} 卷)
                          </p>
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
                            <>
                              {validationErrors.shippingItems?.[product.id]?.rolls && (
                                <p className="text-sm text-red-600 mb-2">{validationErrors.shippingItems[product.id].rolls}</p>
                              )}
                              {validationErrors.shippingItems?.[product.id]?.quantities && (
                                <p className="text-sm text-red-600 mb-2">{validationErrors.shippingItems[product.id].quantities}</p>
                              )}
                              {selectedItem.rolls.map((roll, rollIndex) => {
                              const rollSelectorKey = `${product.id}-${rollIndex}`;
                              const selectedRoll = availableRollsForProduct.find(r => r.id === roll.inventory_roll_id);
                              const maxQuantity = selectedRoll ? selectedRoll.current_quantity : 0;
                              const showQuantityValidation = selectedRoll && roll.shipped_quantity > 0;
                              
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
                                          <ScrollArea className="max-h-60">
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
                                          </ScrollArea>
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
                                    {showQuantityValidation && roll.shipped_quantity > maxQuantity && (
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
                            })}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}

          {validationErrors.selectedItems && (
            <div className="text-sm text-red-600 mt-2">
              {validationErrors.selectedItems}
            </div>
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
