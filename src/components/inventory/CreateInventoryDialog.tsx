
import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Plus, Trash } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
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
  unit_price: number;
  products_new: {
    name: string;
    color?: string;
  };
}

interface InventoryRoll {
  received_quantity: number;
  quality: 'A' | 'B' | 'C' | 'D' | 'defective';
}

interface InventoryItem {
  purchase_order_item_id: string;
  product_id: string;
  rolls: InventoryRoll[];
}

export const CreateInventoryDialog: React.FC<CreateInventoryDialogProps> = ({
  open,
  onOpenChange,
}) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [purchaseOrderId, setPurchaseOrderId] = useState('');
  const [arrivalDate, setArrivalDate] = useState(new Date().toISOString().split('T')[0]);
  const [note, setNote] = useState('');
  const [selectedItems, setSelectedItems] = useState<InventoryItem[]>([]);

  // 獲取採購單
  const { data: purchaseOrders } = useQuery({
    queryKey: ['purchase-orders-for-inventory'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('purchase_orders')
        .select(`
          id,
          po_number,
          factories (name),
          status
        `)
        .in('status', ['confirmed', 'partial_received'])
        .order('po_number');
      
      if (error) throw error;
      return data;
    }
  });

  // 獲取選中採購單的項目
  const { data: purchaseOrderItems } = useQuery({
    queryKey: ['purchase-order-items', purchaseOrderId],
    queryFn: async () => {
      if (!purchaseOrderId) return [];
      
      const { data, error } = await supabase
        .from('purchase_order_items')
        .select(`
          id,
          product_id,
          ordered_quantity,
          received_quantity,
          unit_price,
          products_new (name, color)
        `)
        .eq('purchase_order_id', purchaseOrderId)
        .neq('status', 'received'); // 只顯示未完全收貨的項目
      
      if (error) throw error;
      return data as PurchaseOrderItem[];
    },
    enabled: !!purchaseOrderId
  });

  // 獲取倉庫
  const { data: warehouses } = useQuery({
    queryKey: ['warehouses'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('warehouses')
        .select('id, name')
        .order('name');
      
      if (error) throw error;
      return data;
    }
  });

  const createInventoryMutation = useMutation({
    mutationFn: async (inventoryData: {
      purchase_order_id: string;
      arrival_date: string;
      note?: string;
      items: InventoryItem[];
    }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      // 獲取採購單的工廠ID
      const { data: purchaseOrder, error: poError } = await supabase
        .from('purchase_orders')
        .select('factory_id')
        .eq('id', inventoryData.purchase_order_id)
        .single();

      if (poError) throw poError;

      // 建立庫存記錄
      const { data: inventory, error: inventoryError } = await supabase
        .from('inventories')
        .insert({
          purchase_order_id: inventoryData.purchase_order_id,
          factory_id: purchaseOrder.factory_id,
          arrival_date: inventoryData.arrival_date,
          note: inventoryData.note || null,
          user_id: user.id
        })
        .select()
        .single();

      if (inventoryError) throw inventoryError;

      // 為每個項目的每卷建立庫存布卷記錄
      for (const item of inventoryData.items) {
        const defaultWarehouse = warehouses?.[0];
        if (!defaultWarehouse) throw new Error('No warehouse available');

        for (const roll of item.rolls) {
          // 生成布卷編號
          const rollNumber = `ROLL-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

          const { error: rollError } = await supabase
            .from('inventory_rolls')
            .insert({
              inventory_id: inventory.id,
              product_id: item.product_id,
              roll_number: rollNumber,
              quantity: roll.received_quantity,
              current_quantity: roll.received_quantity,
              quality: roll.quality,
              warehouse_id: defaultWarehouse.id,
              is_allocated: false
            });

          if (rollError) throw rollError;
        }
      }

      return inventory;
    },
    onSuccess: () => {
      toast({
        title: "成功",
        description: "庫存入庫記錄已成功建立",
      });
      queryClient.invalidateQueries({ queryKey: ['inventories'] });
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      onOpenChange(false);
      resetForm();
    },
    onError: (error) => {
      console.error('Error creating inventory:', error);
      toast({
        title: "錯誤",
        description: "建立庫存記錄時發生錯誤",
        variant: "destructive",
      });
    },
  });

  const resetForm = () => {
    setPurchaseOrderId('');
    setArrivalDate(new Date().toISOString().split('T')[0]);
    setNote('');
    setSelectedItems([]);
  };

  const toggleItemSelection = (item: PurchaseOrderItem, checked: boolean) => {
    if (checked) {
      setSelectedItems(prev => [...prev, {
        purchase_order_item_id: item.id,
        product_id: item.product_id,
        rolls: [{
          received_quantity: item.ordered_quantity - (item.received_quantity || 0),
          quality: 'A'
        }]
      }]);
    } else {
      setSelectedItems(prev => prev.filter(i => i.purchase_order_item_id !== item.id));
    }
  };

  const addRollToItem = (itemId: string) => {
    setSelectedItems(prev => prev.map(item => 
      item.purchase_order_item_id === itemId 
        ? { ...item, rolls: [...item.rolls, { received_quantity: 0, quality: 'A' }] }
        : item
    ));
  };

  const removeRollFromItem = (itemId: string, rollIndex: number) => {
    setSelectedItems(prev => prev.map(item => 
      item.purchase_order_item_id === itemId 
        ? { ...item, rolls: item.rolls.filter((_, index) => index !== rollIndex) }
        : item
    ));
  };

  const updateRollQuantity = (itemId: string, rollIndex: number, quantity: number) => {
    setSelectedItems(prev => prev.map(item => 
      item.purchase_order_item_id === itemId 
        ? { 
            ...item, 
            rolls: item.rolls.map((roll, index) => 
              index === rollIndex ? { ...roll, received_quantity: quantity } : roll
            )
          }
        : item
    ));
  };

  const updateRollQuality = (itemId: string, rollIndex: number, quality: 'A' | 'B' | 'C' | 'D' | 'defective') => {
    setSelectedItems(prev => prev.map(item => 
      item.purchase_order_item_id === itemId 
        ? { 
            ...item, 
            rolls: item.rolls.map((roll, index) => 
              index === rollIndex ? { ...roll, quality } : roll
            )
          }
        : item
    ));
  };

  const handleSubmit = () => {
    if (!purchaseOrderId) {
      toast({
        title: "錯誤",
        description: "請選擇採購單",
        variant: "destructive",
      });
      return;
    }

    const validItems = selectedItems.filter(item => 
      item.rolls.some(roll => roll.received_quantity > 0)
    );

    if (validItems.length === 0) {
      toast({
        title: "錯誤",
        description: "請選擇至少一個有效的入庫項目",
        variant: "destructive",
      });
      return;
    }

    createInventoryMutation.mutate({
      purchase_order_id: purchaseOrderId,
      arrival_date: arrivalDate,
      note: note || undefined,
      items: validItems
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-gray-900">新增入庫</DialogTitle>
          <DialogDescription className="text-gray-700">
            選擇採購單並確認已到貨的項目
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="purchase_order" className="text-gray-800">採購單 *</Label>
              <Select value={purchaseOrderId} onValueChange={setPurchaseOrderId}>
                <SelectTrigger className="border-gray-300 text-gray-900 focus:border-blue-500 focus:ring-blue-500">
                  <SelectValue placeholder="選擇採購單" />
                </SelectTrigger>
                <SelectContent>
                  {purchaseOrders?.map((po) => (
                    <SelectItem key={po.id} value={po.id}>
                      {po.po_number} - {po.factories?.name} ({po.status === 'confirmed' ? '已確認' : '部分收貨'})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="arrival_date" className="text-gray-800">到貨日期 *</Label>
              <Input
                id="arrival_date"
                type="date"
                value={arrivalDate}
                onChange={(e) => setArrivalDate(e.target.value)}
                className="border-gray-300 text-gray-900 focus:border-blue-500 focus:ring-blue-500"
              />
            </div>

            <div className="md:col-span-2 space-y-2">
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

          {purchaseOrderItems && purchaseOrderItems.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-gray-900">採購單項目</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {purchaseOrderItems.map((item) => {
                  const isSelected = selectedItems.some(si => si.purchase_order_item_id === item.id);
                  const selectedItem = selectedItems.find(si => si.purchase_order_item_id === item.id);
                  const remainingQuantity = item.ordered_quantity - (item.received_quantity || 0);

                  return (
                    <div key={item.id} className="border border-gray-200 rounded p-4 space-y-3">
                      <div className="flex items-center space-x-3">
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={(checked) => toggleItemSelection(item, checked as boolean)}
                          className="border-gray-400 data-[state=checked]:bg-blue-600 data-[state=checked]:border-blue-600"
                        />
                        <div>
                          <h4 className="font-medium text-gray-900">
                            {item.products_new.name} {item.products_new.color && `(${item.products_new.color})`}
                          </h4>
                          <p className="text-sm text-gray-600">
                            訂購數量: {item.ordered_quantity}kg | 
                            已收貨: {item.received_quantity || 0}kg | 
                            待收貨: {remainingQuantity}kg
                          </p>
                        </div>
                      </div>

                      {isSelected && selectedItem && (
                        <div className="pl-6 space-y-3">
                          <div className="flex justify-between items-center">
                            <Label className="text-gray-800">布卷明細</Label>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => addRollToItem(item.id)}
                              className="border-gray-300 text-gray-700 hover:bg-gray-50"
                            >
                              <Plus className="h-4 w-4 mr-2" />
                              新增布卷
                            </Button>
                          </div>

                          {selectedItem.rolls.map((roll, rollIndex) => (
                            <div key={rollIndex} className="grid grid-cols-1 md:grid-cols-3 gap-4 p-3 border border-gray-100 rounded">
                              <div className="space-y-2">
                                <Label className="text-gray-800">數量 (公斤)</Label>
                                <Input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  max={remainingQuantity}
                                  value={roll.received_quantity || 0}
                                  onChange={(e) => updateRollQuantity(item.id, rollIndex, parseFloat(e.target.value) || 0)}
                                  className="border-gray-300 text-gray-900 focus:border-blue-500 focus:ring-blue-500"
                                />
                              </div>

                              <div className="space-y-2">
                                <Label className="text-gray-800">品質等級</Label>
                                <Select 
                                  value={roll.quality}
                                  onValueChange={(value) => updateRollQuality(item.id, rollIndex, value as 'A' | 'B' | 'C' | 'D' | 'defective')}
                                >
                                  <SelectTrigger className="border-gray-300 text-gray-900 focus:border-blue-500 focus:ring-blue-500">
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

                              <div className="flex items-end">
                                {selectedItem.rolls.length > 1 && (
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => removeRollFromItem(item.id, rollIndex)}
                                    className="text-red-600 hover:text-red-800 border-red-300 hover:bg-red-50"
                                  >
                                    <Trash className="h-4 w-4" />
                                  </Button>
                                )}
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
          <Button variant="outline" onClick={() => onOpenChange(false)} className="text-gray-700 border-gray-300 hover:bg-gray-50">
            取消
          </Button>
          <Button 
            onClick={handleSubmit}
            disabled={createInventoryMutation.isPending}
            className="bg-blue-600 text-white hover:bg-blue-700"
          >
            {createInventoryMutation.isPending ? '建立中...' : '建立入庫記錄'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
