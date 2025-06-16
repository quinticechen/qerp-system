
import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Plus, Trash2, Check, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface CreatePurchaseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface OrderProduct {
  id: string;
  quantity: number;
  products_new: {
    id: string;
    name: string;
    color: string | null;
    color_code: string | null;
  };
  orders: {
    id: string;
    order_number: string;
  };
}

interface InventoryInfo {
  product_id: string;
  total_stock: number;
  a_grade_stock: number;
  b_grade_stock: number;
  c_grade_stock: number;
  d_grade_stock: number;
  defective_stock: number;
}

interface PurchaseItem {
  product_id: string;
  ordered_quantity: number;
  unit_price: number;
  specifications?: string;
  selected_product_name?: string;
}

export const CreatePurchaseDialog: React.FC<CreatePurchaseDialogProps> = ({
  open,
  onOpenChange,
}) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [factoryId, setFactoryId] = useState('');
  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([]);
  const [expectedArrivalDate, setExpectedArrivalDate] = useState('');
  const [note, setNote] = useState('');
  const [items, setItems] = useState<PurchaseItem[]>([{
    product_id: '',
    ordered_quantity: 0,
    unit_price: 0,
    specifications: '',
    selected_product_name: ''
  }]);

  // UI state for comboboxes
  const [factoryOpen, setFactoryOpen] = useState(false);
  const [orderSearchOpen, setOrderSearchOpen] = useState(false);
  const [productNameOpens, setProductNameOpens] = useState<Record<number, boolean>>({});
  const [colorOpens, setColorOpens] = useState<Record<number, boolean>>({});

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

  // Fetch order products for selected orders
  const { data: orderProducts } = useQuery({
    queryKey: ['order-products', selectedOrderIds],
    queryFn: async () => {
      if (selectedOrderIds.length === 0) return [];
      
      const { data, error } = await supabase
        .from('order_products')
        .select(`
          id,
          quantity,
          products_new (id, name, color, color_code),
          orders (id, order_number)
        `)
        .in('order_id', selectedOrderIds);
      
      if (error) throw error;
      return data as OrderProduct[];
    },
    enabled: selectedOrderIds.length > 0
  });

  // Fetch inventory summary for stock information
  const { data: inventoryInfo } = useQuery({
    queryKey: ['inventory-info'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inventory_summary')
        .select('product_id, total_stock, a_grade_stock, b_grade_stock, c_grade_stock, d_grade_stock, defective_stock');
      
      if (error) throw error;
      return data as InventoryInfo[];
    }
  });

  // Fetch products for manual addition
  const { data: products } = useQuery({
    queryKey: ['products'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products_new')
        .select('id, name, color, color_code')
        .order('name, color');
      
      if (error) throw error;
      return data;
    }
  });

  // Get unique product names
  const uniqueProductNames = [...new Set(products?.map(p => p.name) || [])];

  // Get color variants for a specific product name
  const getColorVariants = (productName: string) => {
    return products?.filter(p => p.name === productName) || [];
  };

  // Get inventory info for a product
  const getInventoryInfo = (productId: string) => {
    return inventoryInfo?.find(info => info.product_id === productId);
  };

  const createPurchaseMutation = useMutation({
    mutationFn: async (purchaseData: {
      factory_id: string;
      order_ids: string[];
      expected_arrival_date?: string;
      note?: string;
      items: PurchaseItem[];
    }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      // Create purchase order
      const insertData: any = {
        factory_id: purchaseData.factory_id,
        expected_arrival_date: purchaseData.expected_arrival_date || null,
        note: purchaseData.note || null,
        status: 'confirmed',
        user_id: user.id
      };

      // If multiple orders selected, store them as JSON in note or create separate relation table
      if (purchaseData.order_ids.length > 0) {
        const orderNumbers = orders?.filter(o => purchaseData.order_ids.includes(o.id)).map(o => o.order_number);
        insertData.note = `關聯訂單: ${orderNumbers?.join(', ')}${purchaseData.note ? `\n備註: ${purchaseData.note}` : ''}`;
      }

      const { data: purchase, error: purchaseError } = await supabase
        .from('purchase_orders')
        .insert(insertData)
        .select()
        .single();

      if (purchaseError) throw purchaseError;

      // Create purchase order items
      const itemsToInsert = purchaseData.items.map(item => ({
        purchase_order_id: purchase.id,
        product_id: item.product_id,
        ordered_quantity: item.ordered_quantity,
        ordered_rolls: 0,
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
        description: "採購單已成功建立並設為已下單狀態",
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
    setSelectedOrderIds([]);
    setExpectedArrivalDate('');
    setNote('');
    setItems([{
      product_id: '',
      ordered_quantity: 0,
      unit_price: 0,
      specifications: '',
      selected_product_name: ''
    }]);
    setProductNameOpens({});
    setColorOpens({});
  };

  const handleOrderSelection = (orderId: string, checked: boolean) => {
    if (checked) {
      setSelectedOrderIds(prev => [...prev, orderId]);
    } else {
      setSelectedOrderIds(prev => prev.filter(id => id !== orderId));
    }
  };

  const addItem = () => {
    setItems([...items, {
      product_id: '',
      ordered_quantity: 0,
      unit_price: 0,
      specifications: '',
      selected_product_name: ''
    }]);
  };

  const removeItem = (index: number) => {
    if (items.length > 1) {
      setItems(items.filter((_, i) => i !== index));
      // Clean up UI state
      const newProductNameOpens = { ...productNameOpens };
      const newColorOpens = { ...colorOpens };
      delete newProductNameOpens[index];
      delete newColorOpens[index];
      setProductNameOpens(newProductNameOpens);
      setColorOpens(newColorOpens);
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
      order_ids: selectedOrderIds,
      expected_arrival_date: expectedArrivalDate || undefined,
      note: note || undefined,
      items: validItems
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
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
              <Popover open={factoryOpen} onOpenChange={setFactoryOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={factoryOpen}
                    className="w-full justify-between border-gray-300 text-gray-900 hover:bg-gray-50"
                  >
                    {factoryId
                      ? factories?.find((factory) => factory.id === factoryId)?.name
                      : "選擇工廠..."}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
                  <Command>
                    <CommandInput placeholder="搜尋工廠..." className="h-9" />
                    <CommandList>
                      <CommandEmpty>未找到工廠。</CommandEmpty>
                      <CommandGroup>
                        {factories?.map((factory) => (
                          <CommandItem
                            key={factory.id}
                            value={factory.name}
                            onSelect={() => {
                              setFactoryId(factory.id);
                              setFactoryOpen(false);
                            }}
                            className="cursor-pointer"
                          >
                            {factory.name}
                            <Check
                              className={cn(
                                "ml-auto h-4 w-4",
                                factoryId === factory.id ? "opacity-100" : "opacity-0"
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
              <Label htmlFor="arrival_date" className="text-gray-800">預計到貨日期</Label>
              <Input
                id="arrival_date"
                type="date"
                value={expectedArrivalDate}
                onChange={(e) => setExpectedArrivalDate(e.target.value)}
                className="border-gray-300 text-gray-900 focus:border-blue-500 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Order Selection */}
          <Card>
            <CardHeader>
              <CardTitle className="text-gray-900 flex items-center justify-between">
                關聯訂單 (可選擇多個)
                <Popover open={orderSearchOpen} onOpenChange={setOrderSearchOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" className="ml-2">
                      <Plus className="h-4 w-4 mr-1" />
                      搜尋並添加訂單
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-80 p-0">
                    <Command>
                      <CommandInput placeholder="搜尋訂單編號..." className="h-9" />
                      <CommandList>
                        <CommandEmpty>未找到訂單。</CommandEmpty>
                        <CommandGroup>
                          {orders?.map((order) => (
                            <CommandItem
                              key={order.id}
                              value={order.order_number}
                              onSelect={() => {
                                if (!selectedOrderIds.includes(order.id)) {
                                  setSelectedOrderIds(prev => [...prev, order.id]);
                                }
                                setOrderSearchOpen(false);
                              }}
                              className="cursor-pointer"
                            >
                              {order.order_number}
                              <Check
                                className={cn(
                                  "ml-auto h-4 w-4",
                                  selectedOrderIds.includes(order.id) ? "opacity-100" : "opacity-0"
                                )}
                              />
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {selectedOrderIds.length > 0 ? (
                selectedOrderIds.map((orderId) => {
                  const order = orders?.find(o => o.id === orderId);
                  return (
                    <div key={orderId} className="flex items-center justify-between p-2 bg-blue-50 rounded">
                      <span className="text-gray-800">{order?.order_number}</span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setSelectedOrderIds(prev => prev.filter(id => id !== orderId))}
                        className="text-red-600 hover:text-red-700"
                      >
                        移除
                      </Button>
                    </div>
                  );
                })
              ) : (
                <div className="text-gray-500 text-sm">尚未選擇訂單</div>
              )}
            </CardContent>
          </Card>

          {/* Order Products Display */}
          {orderProducts && orderProducts.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-gray-900">關聯訂單產品資訊</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {orderProducts.map((orderProduct) => {
                    const inventory = getInventoryInfo(orderProduct.products_new.id);
                    
                    return (
                      <div key={orderProduct.id} className="border border-gray-200 rounded p-3">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          <div>
                            <div className="font-medium text-gray-900">
                              {orderProduct.products_new.name}
                            </div>
                            <div className="text-sm text-gray-600">
                              {orderProduct.products_new.color && (
                                <span className="flex items-center space-x-2">
                                  {orderProduct.products_new.color_code && (
                                    <div 
                                      className="w-4 h-4 rounded border border-gray-400"
                                      style={{ backgroundColor: orderProduct.products_new.color_code }}
                                    ></div>
                                  )}
                                  <span>{orderProduct.products_new.color} {orderProduct.products_new.color_code}</span>
                                </span>
                              )}
                            </div>
                            <div className="text-sm text-gray-500">
                              訂單: {orderProduct.orders.order_number}
                            </div>
                          </div>
                          
                          <div>
                            <div className="text-sm text-gray-600">訂單數量</div>
                            <div className="font-medium text-gray-900">{orderProduct.quantity} kg</div>
                          </div>
                          
                          <div>
                            <div className="text-sm text-gray-600">庫存資訊</div>
                            {inventory ? (
                              <div className="text-sm">
                                <div>總庫存: {inventory.total_stock.toFixed(2)} kg</div>
                                <div className="text-xs text-gray-500">
                                  A:{inventory.a_grade_stock.toFixed(2)} B:{inventory.b_grade_stock.toFixed(2)} 
                                  C:{inventory.c_grade_stock.toFixed(2)} D:{inventory.d_grade_stock.toFixed(2)}
                                </div>
                              </div>
                            ) : (
                              <div className="text-sm text-red-600">無庫存</div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Manual Items Section */}
          <Card>
            <CardHeader>
              <CardTitle className="text-gray-900 flex items-center justify-between">
                採購項目
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
                const colorVariants = getColorVariants(item.selected_product_name || '');
                
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

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                      <div className="space-y-2">
                        <Label className="text-gray-800">產品名稱 *</Label>
                        <Popover 
                          open={productNameOpens[index] || false} 
                          onOpenChange={(open) => setProductNameOpens(prev => ({ ...prev, [index]: open }))}
                        >
                          <PopoverTrigger asChild>
                            <Button
                              variant="outline"
                              role="combobox"
                              className="w-full justify-between border-gray-300 text-gray-900 hover:bg-gray-50"
                            >
                              {item.selected_product_name || "選擇產品名稱..."}
                              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
                            <Command>
                              <CommandInput placeholder="搜尋產品名稱..." className="h-9" />
                              <CommandList>
                                <CommandEmpty>未找到產品。</CommandEmpty>
                                <CommandGroup>
                                  {uniqueProductNames.map((name) => (
                                    <CommandItem
                                      key={name}
                                      value={name}
                                      onSelect={(currentValue) => {
                                        updateItem(index, 'selected_product_name', currentValue);
                                        updateItem(index, 'product_id', '');
                                        setProductNameOpens(prev => ({ ...prev, [index]: false }));
                                      }}
                                      className="cursor-pointer"
                                    >
                                      {name}
                                      <Check
                                        className={cn(
                                          "ml-auto h-4 w-4",
                                          item.selected_product_name === name ? "opacity-100" : "opacity-0"
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
                        <Label className="text-gray-800">顏色/色碼 *</Label>
                        <Popover 
                          open={colorOpens[index] || false} 
                          onOpenChange={(open) => setColorOpens(prev => ({ ...prev, [index]: open }))}
                        >
                          <PopoverTrigger asChild>
                            <Button
                              variant="outline"
                              role="combobox"
                              disabled={!item.selected_product_name}
                              className="w-full justify-between border-gray-300 text-gray-900 hover:bg-gray-50"
                            >
                              {item.product_id ? (
                                (() => {
                                  const selectedVariant = colorVariants.find(v => v.id === item.product_id);
                                  return selectedVariant ? (
                                    <div className="flex items-center space-x-2">
                                      {selectedVariant.color_code && (
                                        <div 
                                          className="w-4 h-4 rounded border border-gray-400"
                                          style={{ backgroundColor: selectedVariant.color_code }}
                                        ></div>
                                      )}
                                      <span>
                                        {selectedVariant.color || '無顏色'} {selectedVariant.color_code ? `(${selectedVariant.color_code})` : ''}
                                      </span>
                                    </div>
                                  ) : "選擇顏色...";
                                })()
                              ) : "選擇顏色..."}
                              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
                            <Command>
                              <CommandInput placeholder="搜尋顏色..." className="h-9" />
                              <CommandList>
                                <CommandEmpty>未找到顏色。</CommandEmpty>
                                <CommandGroup>
                                  {colorVariants.map((variant) => (
                                    <CommandItem
                                      key={variant.id}
                                      value={`${variant.color || '無顏色'} ${variant.color_code || ''}`}
                                      onSelect={() => {
                                        updateItem(index, 'product_id', variant.id);
                                        setColorOpens(prev => ({ ...prev, [index]: false }));
                                      }}
                                      className="cursor-pointer"
                                    >
                                      <div className="flex items-center space-x-2">
                                        {variant.color_code && (
                                          <div 
                                            className="w-4 h-4 rounded border border-gray-400"
                                            style={{ backgroundColor: variant.color_code }}
                                          ></div>
                                        )}
                                        <span>
                                          {variant.color || '無顏色'} {variant.color_code ? `(${variant.color_code})` : ''}
                                        </span>
                                      </div>
                                      <Check
                                        className={cn(
                                          "ml-auto h-4 w-4",
                                          item.product_id === variant.id ? "opacity-100" : "opacity-0"
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

                    <div className="text-sm text-gray-600">
                      小計: ${(item.ordered_quantity * item.unit_price).toFixed(2)}
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>

          {/* Note */}
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
