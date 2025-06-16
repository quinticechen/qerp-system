import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Checkbox } from '@/components/ui/checkbox';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Plus, Trash2, Check, ChevronsUpDown, AlertTriangle } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

interface CreateInventoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface PurchaseOrderItem {
  id: string;
  product_id: string;
  ordered_quantity: number;
  received_quantity: number;
  products_new: {
    name: string;
    color?: string;
    color_code?: string;
  };
}

interface InventoryRoll {
  productId: string;
  quantity: number;
  quality: 'A' | 'B' | 'C' | 'D' | 'defective';
  warehouseId: string;
  shelf?: string;
}

interface SelectedProduct {
  orderItemId: string;
  productId: string;
  rolls: InventoryRoll[];
}

export const CreateInventoryDialog: React.FC<CreateInventoryDialogProps> = ({
  open,
  onOpenChange,
}) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [selectedPurchaseOrderId, setSelectedPurchaseOrderId] = useState('');
  const [arrivalDate, setArrivalDate] = useState(new Date().toISOString().split('T')[0]);
  const [note, setNote] = useState('');
  const [selectedProducts, setSelectedProducts] = useState<SelectedProduct[]>([]);
  const [purchaseOrderSearchOpen, setPurchaseOrderSearchOpen] = useState(false);
  const [showWeightWarning, setShowWeightWarning] = useState(false);
  const [forceCreateInventory, setForceCreateInventory] = useState(false);

  const { data: purchaseOrders, isLoading: isPurchaseOrdersLoading } = useQuery({
    queryKey: ['purchase-orders-for-inventory'],
    queryFn: async () => {
      const { data: allPurchaseOrders, error } = await supabase
        .from('purchase_orders')
        .select(`
          id,
          po_number,
          factory_id,
          status,
          factories (name),
          purchase_order_items (
            id,
            product_id,
            ordered_quantity,
            received_quantity,
            status,
            products_new (name, color, color_code)
          )
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;
      
      if (!allPurchaseOrders) return [];

      return allPurchaseOrders.filter(po => {
        return po.purchase_order_items?.some(item => {
          const remaining = item.ordered_quantity - (item.received_quantity || 0);
          return remaining > 0;
        });
      });
    }
  });

  const { data: warehouses } = useQuery({
    queryKey: ['warehouses'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('warehouses')
        .select('*')
        .order('name');
      if (error) throw error;
      return data;
    }
  });

  const selectedPurchaseOrder = purchaseOrders?.find(po => po.id === selectedPurchaseOrderId);

  const generateRollNumber = async () => {
    const now = new Date();
    const year = now.getFullYear().toString().slice(-2);
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const day = now.getDate().toString().padStart(2, '0');
    const timestamp = now.getTime().toString();
    const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    
    let rollNumber = `R${year}${month}${day}${timestamp.slice(-6)}${random}`;
    
    const { data: existingRoll } = await supabase
      .from('inventory_rolls')
      .select('id')
      .eq('roll_number', rollNumber)
      .single();
    
    if (existingRoll) {
      const extraRandom = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
      rollNumber = `R${year}${month}${day}${timestamp.slice(-4)}${extraRandom}`;
    }
    
    return rollNumber;
  };

  const checkWeightExceedsOrdered = () => {
    const purchaseOrder = purchaseOrders?.find(po => po.id === selectedPurchaseOrderId);
    if (!purchaseOrder) return false;

    for (const selectedProduct of selectedProducts) {
      const orderItem = purchaseOrder.purchase_order_items?.find(item => item.id === selectedProduct.orderItemId);
      if (!orderItem) continue;

      const totalRollWeight = selectedProduct.rolls.reduce((sum, roll) => sum + roll.quantity, 0);
      const remainingQuantity = orderItem.ordered_quantity - (orderItem.received_quantity || 0);
      
      if (totalRollWeight > remainingQuantity) {
        return true;
      }
    }
    return false;
  };

  const toggleProductSelection = (orderItem: PurchaseOrderItem, checked: boolean) => {
    if (checked) {
      const remainingQuantity = orderItem.ordered_quantity - (orderItem.received_quantity || 0);
      setSelectedProducts(prev => [...prev, {
        orderItemId: orderItem.id,
        productId: orderItem.product_id,
        rolls: [{
          productId: orderItem.product_id,
          quantity: remainingQuantity,
          quality: 'A',
          warehouseId: '',
          shelf: ''
        }]
      }]);
    } else {
      setSelectedProducts(prev => prev.filter(p => p.orderItemId !== orderItem.id));
    }
  };

  const addRollToProduct = (orderItemId: string, productId: string) => {
    setSelectedProducts(prev => prev.map(product => 
      product.orderItemId === orderItemId 
        ? { 
            ...product, 
            rolls: [...product.rolls, {
              productId,
              quantity: 0,
              quality: 'A',
              warehouseId: '',
              shelf: ''
            }]
          }
        : product
    ));
  };

  const removeRollFromProduct = (orderItemId: string, rollIndex: number) => {
    setSelectedProducts(prev => prev.map(product => 
      product.orderItemId === orderItemId 
        ? { ...product, rolls: product.rolls.filter((_, index) => index !== rollIndex) }
        : product
    ));
  };

  const updateRoll = (orderItemId: string, rollIndex: number, field: keyof InventoryRoll, value: any) => {
    setSelectedProducts(prev => prev.map(product => 
      product.orderItemId === orderItemId 
        ? { 
            ...product, 
            rolls: product.rolls.map((roll, index) => 
              index === rollIndex ? { ...roll, [field]: value } : roll
            )
          }
        : product
    ));
  };

  const createInventoryMutation = useMutation({
    mutationFn: async () => {
      if (!selectedPurchaseOrderId || selectedProducts.length === 0) {
        throw new Error('請選擇採購單並新增至少一個產品');
      }

      const purchaseOrder = purchaseOrders?.find(po => po.id === selectedPurchaseOrderId);
      if (!purchaseOrder) {
        throw new Error('找不到選中的採購單');
      }

      const invalidRolls = selectedProducts.some(product => 
        product.rolls.some(roll => !roll.warehouseId || roll.quantity <= 0)
      );

      if (invalidRolls) {
        throw new Error('請確保所有布卷都有完整的資訊（倉庫、重量）');
      }

      const { data: inventory, error: inventoryError } = await supabase
        .from('inventories')
        .insert({
          purchase_order_id: selectedPurchaseOrderId,
          factory_id: purchaseOrder.factory_id,
          arrival_date: arrivalDate,
          note,
          user_id: (await supabase.auth.getUser()).data.user?.id || ''
        })
        .select()
        .single();

      if (inventoryError) {
        throw inventoryError;
      }

      const allRolls = [];
      for (const product of selectedProducts) {
        for (const roll of product.rolls) {
          const rollNumber = await generateRollNumber();
          allRolls.push({
            inventory_id: inventory.id,
            product_id: roll.productId,
            roll_number: rollNumber,
            quantity: roll.quantity,
            current_quantity: roll.quantity,
            quality: roll.quality,
            warehouse_id: roll.warehouseId,
            shelf: roll.shelf || null
          });
        }
      }

      for (const rollData of allRolls) {
        const { error: rollError } = await supabase
          .from('inventory_rolls')
          .insert(rollData);

        if (rollError) {
          throw rollError;
        }
      }

      return inventory;
    },
    onSuccess: () => {
      toast({
        title: "入庫成功",
        description: "庫存記錄已成功建立",
      });
      queryClient.invalidateQueries({ queryKey: ['inventories'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-summary'] });
      queryClient.invalidateQueries({ queryKey: ['purchase-orders-for-inventory'] });
      onOpenChange(false);
      resetForm();
    },
    onError: (error: any) => {
      toast({
        title: "入庫失敗",
        description: error.message,
        variant: "destructive",
      });
    }
  });

  const resetForm = () => {
    setSelectedPurchaseOrderId('');
    setArrivalDate(new Date().toISOString().split('T')[0]);
    setNote('');
    setSelectedProducts([]);
    setForceCreateInventory(false);
  };

  const handleSubmit = () => {
    if (checkWeightExceedsOrdered() && !forceCreateInventory) {
      setShowWeightWarning(true);
      return;
    }
    
    createInventoryMutation.mutate();
  };

  const handleForceCreate = () => {
    setForceCreateInventory(true);
    setShowWeightWarning(false);
    createInventoryMutation.mutate();
  };

  const handlePurchaseOrderSelection = (purchaseOrderId: string) => {
    setSelectedPurchaseOrderId(purchaseOrderId);
    setSelectedProducts([]);
    setPurchaseOrderSearchOpen(false);
  };

  useEffect(() => {
    if (!open) {
      resetForm();
    }
  }, [open]);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-gray-900">新增入庫</DialogTitle>
            <DialogDescription className="text-gray-700">
              選擇採購單並確認要入庫的產品項目
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-6">
            <div className="space-y-2">
              <Label className="text-gray-800">採購單 *</Label>
              <Popover open={purchaseOrderSearchOpen} onOpenChange={setPurchaseOrderSearchOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    className="w-full justify-between border-gray-300 text-gray-900 hover:bg-gray-50"
                    disabled={isPurchaseOrdersLoading}
                  >
                    <span className="truncate">
                      {selectedPurchaseOrder 
                        ? `${selectedPurchaseOrder.po_number} - ${selectedPurchaseOrder.factories?.name}`
                        : "選擇採購單..."
                      }
                    </span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0 bg-white shadow-lg border border-gray-200 z-50">
                  <Command>
                    <CommandInput placeholder="搜尋採購單..." className="h-9" />
                    <CommandList>
                      <CommandEmpty>
                        {isPurchaseOrdersLoading ? "載入中..." : "未找到採購單。"}
                      </CommandEmpty>
                      <CommandGroup>
                        {purchaseOrders?.map((po) => {
                          const pendingItemsCount = po.purchase_order_items?.filter(item => 
                            (item.ordered_quantity || 0) > (item.received_quantity || 0)
                          ).length || 0;
                          
                          return (
                            <CommandItem
                              key={po.id}
                              value={`${po.po_number} ${po.factories?.name}`}
                              onSelect={() => handlePurchaseOrderSelection(po.id)}
                              className="cursor-pointer hover:bg-gray-100"
                            >
                              <div className="flex flex-col flex-1">
                                <span className="font-medium">{po.po_number}</span>
                                <span className="text-sm text-gray-500">{po.factories?.name}</span>
                                <div className="text-xs text-blue-600">
                                  {pendingItemsCount} 項待入庫
                                </div>
                              </div>
                              <Check
                                className={cn(
                                  "ml-auto h-4 w-4",
                                  selectedPurchaseOrderId === po.id ? "opacity-100" : "opacity-0"
                                )}
                              />
                            </CommandItem>
                          );
                        })}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-2">
              <Label className="text-gray-800">到貨日期 *</Label>
              <Input
                type="date"
                value={arrivalDate}
                onChange={(e) => setArrivalDate(e.target.value)}
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

            {selectedPurchaseOrder && selectedPurchaseOrder.purchase_order_items && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-gray-900">採購單項目</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {selectedPurchaseOrder.purchase_order_items.map((item) => {
                    const isSelected = selectedProducts.some(sp => sp.orderItemId === item.id);
                    const selectedProduct = selectedProducts.find(sp => sp.orderItemId === item.id);
                    const remainingQuantity = item.ordered_quantity - (item.received_quantity || 0);

                    return (
                      <div key={item.id} className="border border-gray-200 rounded p-4 space-y-3">
                        <div className="flex items-center space-x-3">
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={(checked) => toggleProductSelection(item, checked as boolean)}
                            className="border-gray-400 data-[state=checked]:bg-blue-600 data-[state=checked]:border-blue-600"
                          />
                          <div className="flex-1">
                            <div className="flex items-center space-x-3">
                              {item.products_new.color_code && (
                                <div 
                                  className="w-6 h-6 rounded border border-gray-400 flex-shrink-0"
                                  style={{ backgroundColor: item.products_new.color_code }}
                                />
                              )}
                              <div>
                                <h4 className="font-medium text-gray-900">
                                  {item.products_new.name}
                                </h4>
                                <p className="text-sm text-gray-600">
                                  {item.products_new.color && `顏色: ${item.products_new.color}`}
                                  {item.products_new.color_code && ` (${item.products_new.color_code})`}
                                </p>
                              </div>
                            </div>
                            <div className="flex space-x-2 mt-2">
                              <Badge variant="outline">
                                叫貨: {item.ordered_quantity.toFixed(2)} kg
                              </Badge>
                              <Badge variant="secondary">
                                已收: {(item.received_quantity || 0).toFixed(2)} kg
                              </Badge>
                              <Badge variant="default">
                                待收: {remainingQuantity.toFixed(2)} kg
                              </Badge>
                            </div>
                          </div>
                        </div>

                        {isSelected && selectedProduct && (
                          <div className="pl-6 space-y-3">
                            <div className="flex justify-between items-center">
                              <Label className="text-gray-800">布卷記錄</Label>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => addRollToProduct(item.id, item.product_id)}
                                className="border-gray-300 text-gray-700 hover:bg-gray-50"
                              >
                                <Plus className="h-4 w-4 mr-2" />
                                新增布卷
                              </Button>
                            </div>

                            {selectedProduct.rolls.map((roll, rollIndex) => (
                              <div key={rollIndex} className="grid grid-cols-1 md:grid-cols-4 gap-4 p-3 border border-gray-100 rounded">
                                <div className="space-y-2">
                                  <Label className="text-gray-800">重量 (kg)</Label>
                                  <Input
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    value={roll.quantity || 0}
                                    onChange={(e) => {
                                      const value = parseFloat(e.target.value) || 0;
                                      updateRoll(item.id, rollIndex, 'quantity', value);
                                    }}
                                    className="border-gray-300 text-gray-900 focus:border-blue-500 focus:ring-blue-500"
                                  />
                                </div>

                                <div className="space-y-2">
                                  <Label className="text-gray-800">品級</Label>
                                  <Select
                                    value={roll.quality}
                                    onValueChange={(value) => updateRoll(item.id, rollIndex, 'quality', value)}
                                  >
                                    <SelectTrigger className="border-gray-300 focus:border-blue-500 focus:ring-blue-500">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="A">A級</SelectItem>
                                      <SelectItem value="B">B級</SelectItem>
                                      <SelectItem value="C">C級</SelectItem>
                                      <SelectItem value="D">D級</SelectItem>
                                      <SelectItem value="defective">瑕疵品</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>

                                <div className="space-y-2">
                                  <Label className="text-gray-800">倉庫 *</Label>
                                  <Select
                                    value={roll.warehouseId}
                                    onValueChange={(value) => updateRoll(item.id, rollIndex, 'warehouseId', value)}
                                  >
                                    <SelectTrigger className="border-gray-300 focus:border-blue-500 focus:ring-blue-500">
                                      <SelectValue placeholder="選擇倉庫" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {warehouses?.map((warehouse) => (
                                        <SelectItem key={warehouse.id} value={warehouse.id}>
                                          {warehouse.name}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>

                                <div className="space-y-2">
                                  <Label className="text-gray-800">貨架位置</Label>
                                  <div className="flex space-x-2">
                                    <Input
                                      value={roll.shelf || ''}
                                      onChange={(e) => updateRoll(item.id, rollIndex, 'shelf', e.target.value)}
                                      placeholder="選填"
                                      className="border-gray-300 text-gray-900 focus:border-blue-500 focus:ring-blue-500"
                                    />
                                    {selectedProduct.rolls.length > 1 && (
                                      <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={() => removeRollFromProduct(item.id, rollIndex)}
                                        className="text-red-600 hover:text-red-800 border-red-300 hover:bg-red-50"
                                      >
                                        <Trash2 className="h-4 w-4" />
                                      </Button>
                                    )}
                                  </div>
                                </div>
                              </div>
                            ))}
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
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="text-gray-700 border-gray-300 hover:bg-gray-50"
            >
              取消
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={createInventoryMutation.isPending || !selectedPurchaseOrderId || selectedProducts.length === 0}
              className="bg-blue-600 text-white hover:bg-blue-700"
            >
              {createInventoryMutation.isPending ? '處理中...' : '確認入庫'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showWeightWarning} onOpenChange={setShowWeightWarning}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-orange-600">
              <AlertTriangle className="h-5 w-5" />
              重量超過叫貨數量
            </AlertDialogTitle>
            <AlertDialogDescription>
              部分產品的布卷重量總和超過了剩餘的叫貨數量。這可能會導致庫存數據不一致。
              <br /><br />
              您是否要繼續進行入庫？
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setShowWeightWarning(false)}>
              取消，讓我重新調整
            </AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleForceCreate}
              className="bg-orange-600 hover:bg-orange-700"
            >
              確認繼續入庫
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
