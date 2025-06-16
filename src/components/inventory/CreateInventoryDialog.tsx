import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Plus, Trash2, Check, AlertTriangle } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

interface CreateInventoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface RollData {
  productId: string;
  rollNumber: string;
  quantity: number;
  quality: 'A' | 'B' | 'C' | 'D' | 'defective';
  warehouseId: string;
  shelf?: string;
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
  const [rolls, setRolls] = useState<RollData[]>([]);
  const [purchaseOrderSearchOpen, setPurchaseOrderSearchOpen] = useState(false);
  const [showQuantityWarning, setShowQuantityWarning] = useState(false);
  const [warningCallback, setWarningCallback] = useState<(() => void) | null>(null);

  const { data: purchaseOrders } = useQuery({
    queryKey: ['purchase-orders-for-inventory'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('purchase_orders')
        .select(`
          id,
          po_number,
          factory_id,
          factories (name),
          purchase_order_items (
            id,
            product_id,
            ordered_quantity,
            received_quantity,
            products_new (name, color, color_code)
          )
        `)
        .in('status', ['pending', 'partial_received'])
        .order('created_at', { ascending: false });

      if (error) throw error;
      
      // 過濾掉沒有待入庫項目的採購單
      const filteredData = data?.filter(po => 
        po.purchase_order_items && 
        po.purchase_order_items.some(item => 
          (item.ordered_quantity || 0) > (item.received_quantity || 0)
        )
      ) || [];
      
      return filteredData;
    }
  });

  const { data: products } = useQuery({
    queryKey: ['products'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products_new')
        .select('*')
        .order('name');
      if (error) throw error;
      return data;
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

  const addRoll = () => {
    setRolls([...rolls, {
      productId: '',
      rollNumber: '',
      quantity: 0,
      quality: 'A',
      warehouseId: '',
      shelf: ''
    }]);
  };

  const removeRoll = (index: number) => {
    setRolls(rolls.filter((_, i) => i !== index));
  };

  const updateRoll = (index: number, field: keyof RollData, value: any) => {
    const updatedRolls = [...rolls];
    updatedRolls[index] = { ...updatedRolls[index], [field]: value };
    setRolls(updatedRolls);
  };

  const checkQuantityWarning = () => {
    if (!selectedPurchaseOrder) return false;

    // 計算每個產品的總入庫數量
    const productTotals = new Map<string, number>();
    
    rolls.forEach(roll => {
      if (roll.productId) {
        const current = productTotals.get(roll.productId) || 0;
        productTotals.set(roll.productId, current + roll.quantity);
      }
    });

    // 檢查是否有任何產品超過訂購數量
    for (const [productId, totalQuantity] of productTotals) {
      const orderItem = selectedPurchaseOrder.purchase_order_items?.find(
        item => item.product_id === productId
      );
      
      if (orderItem) {
        const remainingQuantity = orderItem.ordered_quantity - (orderItem.received_quantity || 0);
        if (totalQuantity > remainingQuantity) {
          return true;
        }
      }
    }

    return false;
  };

  const createInventoryMutation = useMutation({
    mutationFn: async () => {
      if (!selectedPurchaseOrderId || rolls.length === 0) {
        throw new Error('請選擇採購單並新增至少一個布卷');
      }

      const purchaseOrder = purchaseOrders?.find(po => po.id === selectedPurchaseOrderId);
      if (!purchaseOrder) {
        throw new Error('找不到選中的採購單');
      }

      // 創建庫存記錄
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

      if (inventoryError) throw inventoryError;

      // 創建布卷記錄
      const rollsData = rolls.map(roll => ({
        inventory_id: inventory.id,
        product_id: roll.productId,
        roll_number: roll.rollNumber,
        quantity: roll.quantity,
        current_quantity: roll.quantity,
        quality: roll.quality,
        warehouse_id: roll.warehouseId,
        shelf: roll.shelf || null
      }));

      const { error: rollsError } = await supabase
        .from('inventory_rolls')
        .insert(rollsData);

      if (rollsError) throw rollsError;

      return inventory;
    },
    onSuccess: () => {
      toast({
        title: "入庫成功",
        description: "庫存記錄已成功建立",
      });
      queryClient.invalidateQueries({ queryKey: ['inventories'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-summary'] });
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
    setRolls([]);
    setShowQuantityWarning(false);
    setWarningCallback(null);
  };

  const handleSubmit = () => {
    if (checkQuantityWarning()) {
      setShowQuantityWarning(true);
      setWarningCallback(() => () => {
        setShowQuantityWarning(false);
        createInventoryMutation.mutate();
      });
    } else {
      createInventoryMutation.mutate();
    }
  };

  const handlePurchaseOrderSelection = (purchaseOrderId: string) => {
    setSelectedPurchaseOrderId(purchaseOrderId);
    setPurchaseOrderSearchOpen(false);
  };

  const getProductDisplay = (productId: string) => {
    const product = products?.find(p => p.id === productId);
    if (!product) return '';
    
    const parts = [product.name];
    if (product.color) parts.push(product.color);
    if (product.color_code) parts.push(`[${product.color_code}]`);
    
    return parts.join(' - ');
  };

  useEffect(() => {
    if (!open) {
      resetForm();
    }
  }, [open]);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-gray-900">新增入庫</DialogTitle>
            <DialogDescription>
              選擇採購單並新增庫存布卷記錄
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-6">
            {/* 採購單選擇 */}
            <div className="space-y-2">
              <Label className="text-gray-900">採購單</Label>
              <Popover open={purchaseOrderSearchOpen} onOpenChange={setPurchaseOrderSearchOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={purchaseOrderSearchOpen}
                    className="w-full justify-between border-gray-300 focus:border-blue-500 focus:ring-blue-500"
                  >
                    {selectedPurchaseOrderId
                      ? `${selectedPurchaseOrder?.po_number} - ${selectedPurchaseOrder?.factories?.name}`
                      : "選擇採購單..."}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-full p-0" style={{ width: 'var(--radix-popover-trigger-width)' }}>
                  <Command>
                    <CommandInput placeholder="搜尋採購單號或工廠..." className="h-9" />
                    <CommandList>
                      <CommandEmpty>未找到採購單。</CommandEmpty>
                      <CommandGroup>
                        {purchaseOrders?.map((po) => (
                          <CommandItem
                            key={po.id}
                            value={`${po.po_number} ${po.factories?.name}`}
                            onSelect={() => handlePurchaseOrderSelection(po.id)}
                            className="cursor-pointer hover:bg-gray-100"
                          >
                            <div className="flex flex-col flex-1">
                              <span className="font-medium">{po.po_number}</span>
                              <span className="text-sm text-gray-500">{po.factories?.name}</span>
                            </div>
                            <Check
                              className={cn(
                                "ml-auto h-4 w-4",
                                selectedPurchaseOrderId === po.id ? "opacity-100" : "opacity-0"
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

            {/* 採購單產品信息顯示 */}
            {selectedPurchaseOrder && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-gray-900">採購單產品</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {selectedPurchaseOrder.purchase_order_items?.map((item) => (
                      <div key={item.id} className="flex items-center justify-between p-2 bg-gray-50 rounded">
                        <div className="flex items-center space-x-3">
                          <span className="font-medium text-gray-900">
                            {item.products_new?.name}
                          </span>
                          {item.products_new?.color && (
                            <span className="text-gray-600">
                              {item.products_new.color}
                            </span>
                          )}
                          {item.products_new?.color_code && (
                            <div className="flex items-center space-x-1">
                              <div 
                                className="w-4 h-4 rounded border border-gray-400"
                                style={{ backgroundColor: item.products_new.color_code }}
                              ></div>
                              <span className="text-sm text-gray-600">
                                {item.products_new.color_code}
                              </span>
                            </div>
                          )}
                        </div>
                        <div className="flex space-x-2">
                          <Badge variant="outline">
                            叫貨: {item.ordered_quantity.toFixed(2)} kg
                          </Badge>
                          <Badge variant="secondary">
                            已收: {(item.received_quantity || 0).toFixed(2)} kg
                          </Badge>
                          <Badge variant="default">
                            待收: {(item.ordered_quantity - (item.received_quantity || 0)).toFixed(2)} kg
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* 到貨日期 */}
            <div className="space-y-2">
              <Label htmlFor="arrival-date" className="text-gray-900">到貨日期</Label>
              <Input
                id="arrival-date"
                type="date"
                value={arrivalDate}
                onChange={(e) => setArrivalDate(e.target.value)}
                className="border-gray-300 focus:border-blue-500 focus:ring-blue-500"
              />
            </div>

            {/* 布卷記錄 */}
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <Label className="text-gray-900">布卷記錄</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addRoll}
                  className="border-gray-300"
                >
                  <Plus className="h-4 w-4 mr-1" />
                  新增布卷
                </Button>
              </div>

              {rolls.map((roll, index) => (
                <Card key={index}>
                  <CardContent className="p-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="space-y-2">
                        <Label className="text-gray-700">產品</Label>
                        <Select
                          value={roll.productId}
                          onValueChange={(value) => updateRoll(index, 'productId', value)}
                        >
                          <SelectTrigger className="border-gray-300 focus:border-blue-500 focus:ring-blue-500">
                            <SelectValue placeholder="選擇產品" />
                          </SelectTrigger>
                          <SelectContent>
                            {selectedPurchaseOrder?.purchase_order_items?.map((item) => (
                              <SelectItem key={item.product_id} value={item.product_id}>
                                <div className="flex items-center space-x-2">
                                  <span>{item.products_new?.name}</span>
                                  {item.products_new?.color && (
                                    <span className="text-gray-500">- {item.products_new.color}</span>
                                  )}
                                  {item.products_new?.color_code && (
                                    <div className="flex items-center space-x-1">
                                      <div 
                                        className="w-3 h-3 rounded border"
                                        style={{ backgroundColor: item.products_new.color_code }}
                                      ></div>
                                      <span className="text-xs text-gray-500">
                                        {item.products_new.color_code}
                                      </span>
                                    </div>
                                  )}
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <Label className="text-gray-700">布卷編號</Label>
                        <Input
                          value={roll.rollNumber}
                          onChange={(e) => updateRoll(index, 'rollNumber', e.target.value)}
                          placeholder="輸入布卷編號"
                          className="border-gray-300 focus:border-blue-500 focus:ring-blue-500"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label className="text-gray-700">重量 (kg)</Label>
                        <Input
                          type="number"
                          step="0.01"
                          value={roll.quantity}
                          onChange={(e) => updateRoll(index, 'quantity', parseFloat(e.target.value) || 0)}
                          placeholder="0.00"
                          className="border-gray-300 focus:border-blue-500 focus:ring-blue-500"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label className="text-gray-700">品級</Label>
                        <Select
                          value={roll.quality}
                          onValueChange={(value) => updateRoll(index, 'quality', value)}
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
                        <Label className="text-gray-700">倉庫</Label>
                        <Select
                          value={roll.warehouseId}
                          onValueChange={(value) => updateRoll(index, 'warehouseId', value)}
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
                        <Label className="text-gray-700">貨架位置</Label>
                        <div className="flex space-x-2">
                          <Input
                            value={roll.shelf || ''}
                            onChange={(e) => updateRoll(index, 'shelf', e.target.value)}
                            placeholder="選填"
                            className="border-gray-300 focus:border-blue-500 focus:ring-blue-500"
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => removeRoll(index)}
                            className="border-red-300 text-red-600 hover:bg-red-50"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* 備註 */}
            <div className="space-y-2">
              <Label htmlFor="note" className="text-gray-900">備註</Label>
              <Textarea
                id="note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="輸入備註（選填）"
                className="border-gray-300 focus:border-blue-500 focus:ring-blue-500"
              />
            </div>

            {/* 操作按鈕 */}
            <div className="flex justify-end space-x-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                className="border-gray-300"
              >
                取消
              </Button>
              <Button
                type="button"
                onClick={handleSubmit}
                disabled={createInventoryMutation.isPending || !selectedPurchaseOrderId || rolls.length === 0}
                className="bg-blue-600 text-white hover:bg-blue-700"
              >
                {createInventoryMutation.isPending ? '處理中...' : '確認入庫'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* 數量警告對話框 */}
      <Dialog open={showQuantityWarning} onOpenChange={setShowQuantityWarning}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center space-x-2 text-orange-600">
              <AlertTriangle className="h-5 w-5" />
              <span>數量超出提醒</span>
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-gray-700">
              您新增的布卷重量總和大於該採購單的叫貨數量，確定要繼續儲存嗎？
            </p>
            <div className="flex justify-end space-x-3">
              <Button
                variant="outline"
                onClick={() => setShowQuantityWarning(false)}
              >
                取消
              </Button>
              <Button
                onClick={() => {
                  if (warningCallback) {
                    warningCallback();
                  }
                }}
                className="bg-orange-600 text-white hover:bg-orange-700"
              >
                確認儲存
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};
