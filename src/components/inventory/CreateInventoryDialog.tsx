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

interface CreateInventoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface InventoryRoll {
  product_id: string;
  warehouse_id: string;
  shelf: string;
  roll_number: string;
  quantity: number;
  quality: 'A' | 'B' | 'C' | 'D' | 'defective';
  specifications: string;
}

export const CreateInventoryDialog = ({ open, onOpenChange }: CreateInventoryDialogProps) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [formData, setFormData] = useState({
    purchase_order_id: '',
    factory_id: '',
    arrival_date: new Date().toISOString().split('T')[0],
    note: ''
  });
  
  const [inventoryRolls, setInventoryRolls] = useState<InventoryRoll[]>([
    {
      product_id: '',
      warehouse_id: '',
      shelf: '',
      roll_number: '',
      quantity: 0,
      quality: 'A' as const,
      specifications: ''
    }
  ]);

  // 獲取採購單列表 - 修復查詢
  const { data: purchaseOrders, isLoading: purchaseOrdersLoading } = useQuery({
    queryKey: ['purchaseOrders'],
    queryFn: async () => {
      console.log('Fetching purchase orders...');
      const { data, error } = await supabase
        .from('purchase_orders')
        .select('id, po_number, factory_id')
        .eq('status', 'confirmed')
        .order('po_number');
      
      if (error) {
        console.error('Error fetching purchase orders:', error);
        throw error;
      }
      console.log('Purchase orders fetched:', data);
      return data;
    }
  });

  // 獲取工廠列表
  const { data: factories, isLoading: factoriesLoading } = useQuery({
    queryKey: ['factories'],
    queryFn: async () => {
      console.log('Fetching factories...');
      const { data, error } = await supabase
        .from('factories')
        .select('id, name')
        .order('name');
      
      if (error) {
        console.error('Error fetching factories:', error);
        throw error;
      }
      console.log('Factories fetched:', data);
      return data;
    }
  });

  // 獲取產品列表
  const { data: products, isLoading: productsLoading } = useQuery({
    queryKey: ['products'],
    queryFn: async () => {
      console.log('Fetching products...');
      const { data, error } = await supabase
        .from('products_new')
        .select('id, name, color')
        .order('name');
      
      if (error) {
        console.error('Error fetching products:', error);
        throw error;
      }
      console.log('Products fetched:', data);
      return data;
    }
  });

  // 獲取倉庫列表 - 修復查詢
  const { data: warehouses, isLoading: warehousesLoading } = useQuery({
    queryKey: ['warehouses'],
    queryFn: async () => {
      console.log('Fetching warehouses...');
      const { data, error } = await supabase
        .from('warehouses')
        .select('id, name')
        .order('name');
      
      if (error) {
        console.error('Error fetching warehouses:', error);
        throw error;
      }
      console.log('Warehouses fetched:', data);
      return data;
    }
  });

  const createInventoryMutation = useMutation({
    mutationFn: async () => {
      // 獲取當前用戶
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('未找到用戶');

      // 創建入庫記錄
      const inventoryData = {
        purchase_order_id: formData.purchase_order_id,
        factory_id: formData.factory_id,
        arrival_date: formData.arrival_date,
        note: formData.note || null,
        user_id: user.id
      };

      console.log('Creating inventory with data:', inventoryData);

      const { data: inventory, error: inventoryError } = await supabase
        .from('inventories')
        .insert(inventoryData)
        .select()
        .single();

      if (inventoryError) {
        console.error('Inventory creation error:', inventoryError);
        throw inventoryError;
      }

      // 創建布卷記錄
      const rollsData = inventoryRolls
        .filter(roll => roll.product_id && roll.warehouse_id && roll.roll_number && roll.quantity > 0)
        .map(roll => ({
          inventory_id: inventory.id,
          product_id: roll.product_id,
          warehouse_id: roll.warehouse_id,
          shelf: roll.shelf || null,
          roll_number: roll.roll_number,
          quantity: roll.quantity,
          current_quantity: roll.quantity,
          quality: roll.quality,
          specifications: roll.specifications ? JSON.stringify({ specifications: roll.specifications }) : null
        }));

      if (rollsData.length === 0) {
        throw new Error('請至少添加一個有效的布卷記錄');
      }

      console.log('Creating inventory rolls with data:', rollsData);

      const { error: rollsError } = await supabase
        .from('inventory_rolls')
        .insert(rollsData);

      if (rollsError) {
        console.error('Inventory rolls creation error:', rollsError);
        throw rollsError;
      }

      return inventory;
    },
    onSuccess: () => {
      toast({
        title: "成功",
        description: "入庫記錄已建立"
      });
      queryClient.invalidateQueries({ queryKey: ['inventories'] });
      onOpenChange(false);
      // 重置表單
      setFormData({
        purchase_order_id: '',
        factory_id: '',
        arrival_date: new Date().toISOString().split('T')[0],
        note: ''
      });
      setInventoryRolls([{
        product_id: '',
        warehouse_id: '',
        shelf: '',
        roll_number: '',
        quantity: 0,
        quality: 'A',
        specifications: ''
      }]);
    },
    onError: (error: any) => {
      console.error('Error creating inventory:', error);
      toast({
        title: "錯誤",
        description: error.message || "建立入庫記錄失敗",
        variant: "destructive"
      });
    }
  });

  const addInventoryRoll = () => {
    setInventoryRolls([...inventoryRolls, {
      product_id: '',
      warehouse_id: '',
      shelf: '',
      roll_number: '',
      quantity: 0,
      quality: 'A',
      specifications: ''
    }]);
  };

  const removeInventoryRoll = (index: number) => {
    if (inventoryRolls.length > 1) {
      setInventoryRolls(inventoryRolls.filter((_, i) => i !== index));
    }
  };

  const updateInventoryRoll = (index: number, field: keyof InventoryRoll, value: any) => {
    const updatedRolls = [...inventoryRolls];
    updatedRolls[index] = { ...updatedRolls[index], [field]: value };
    setInventoryRolls(updatedRolls);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    // 驗證必填欄位
    if (!formData.purchase_order_id) {
      toast({
        title: "錯誤",
        description: "請選擇採購單",
        variant: "destructive"
      });
      return;
    }

    if (!formData.factory_id) {
      toast({
        title: "錯誤",
        description: "請選擇工廠",
        variant: "destructive"
      });
      return;
    }

    const validRolls = inventoryRolls.filter(roll => 
      roll.product_id && roll.warehouse_id && roll.roll_number && roll.quantity > 0
    );

    if (validRolls.length === 0) {
      toast({
        title: "錯誤",
        description: "請至少添加一個有效的布卷記錄",
        variant: "destructive"
      });
      return;
    }

    setInventoryRolls(validRolls);
    createInventoryMutation.mutate();
  };

  const totalQuantity = inventoryRolls.reduce((total, roll) => total + (roll.quantity || 0), 0);
  const totalRolls = inventoryRolls.filter(roll => roll.quantity > 0).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-gray-900">新增入庫</DialogTitle>
          <DialogDescription className="text-gray-600">
            建立新的入庫批次記錄，記錄布卷明細
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="purchase_order" className="text-gray-700">採購單 *</Label>
              <Select 
                value={formData.purchase_order_id} 
                onValueChange={(value) => {
                  console.log('Selected purchase order:', value);
                  setFormData({...formData, purchase_order_id: value});
                  const selectedPO = purchaseOrders?.find(po => po.id === value);
                  if (selectedPO) {
                    setFormData(prev => ({...prev, factory_id: selectedPO.factory_id}));
                  }
                }}
                disabled={purchaseOrdersLoading}
              >
                <SelectTrigger className="border-gray-300 focus:border-blue-500 focus:ring-blue-500">
                  <SelectValue placeholder={purchaseOrdersLoading ? "載入中..." : "選擇採購單"} />
                </SelectTrigger>
                <SelectContent>
                  {purchaseOrders && purchaseOrders.length > 0 ? (
                    purchaseOrders.map((po) => (
                      <SelectItem key={po.id} value={po.id}>
                        {po.po_number}
                      </SelectItem>
                    ))
                  ) : (
                    <SelectItem value="no-data" disabled>
                      {purchaseOrdersLoading ? "載入中..." : "沒有可用的採購單"}
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="factory" className="text-gray-700">工廠 *</Label>
              <Select 
                value={formData.factory_id} 
                onValueChange={(value) => {
                  console.log('Selected factory:', value);
                  setFormData({...formData, factory_id: value});
                }}
                disabled={factoriesLoading}
              >
                <SelectTrigger className="border-gray-300 focus:border-blue-500 focus:ring-blue-500">
                  <SelectValue placeholder={factoriesLoading ? "載入中..." : "選擇工廠"} />
                </SelectTrigger>
                <SelectContent>
                  {factories && factories.length > 0 ? (
                    factories.map((factory) => (
                      <SelectItem key={factory.id} value={factory.id}>
                        {factory.name}
                      </SelectItem>
                    ))
                  ) : (
                    <SelectItem value="no-data" disabled>
                      {factoriesLoading ? "載入中..." : "沒有可用的工廠"}
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="arrival_date" className="text-gray-700">到貨日期 *</Label>
              <Input
                id="arrival_date"
                type="date"
                value={formData.arrival_date}
                onChange={(e) => setFormData({...formData, arrival_date: e.target.value})}
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
                <span className="font-medium text-blue-900">總卷數：</span>
                <span className="text-blue-800">{totalRolls} 卷</span>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <Label className="text-lg font-semibold text-gray-900">布卷明細</Label>
              <Button
                type="button"
                onClick={addInventoryRoll}
                variant="outline"
                size="sm"
                className="border-gray-300 text-gray-700 hover:bg-gray-50"
              >
                <Plus className="h-4 w-4 mr-1" />
                添加布卷
              </Button>
            </div>

            {inventoryRolls.map((roll, index) => (
              <div key={index} className="border border-gray-200 rounded-lg p-4 space-y-4">
                <div className="flex justify-between items-center">
                  <span className="font-medium text-gray-900">布卷 {index + 1}</span>
                  {inventoryRolls.length > 1 && (
                    <Button
                      type="button"
                      onClick={() => removeInventoryRoll(index)}
                      variant="ghost"
                      size="sm"
                      className="text-red-600 hover:text-red-700 hover:bg-red-50"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label className="text-gray-700">產品 *</Label>
                    <Select 
                      value={roll.product_id} 
                      onValueChange={(value) => updateInventoryRoll(index, 'product_id', value)}
                      disabled={productsLoading}
                    >
                      <SelectTrigger className="border-gray-300 focus:border-blue-500 focus:ring-blue-500">
                        <SelectValue placeholder={productsLoading ? "載入中..." : "選擇產品"} />
                      </SelectTrigger>
                      <SelectContent>
                        {products && products.length > 0 ? (
                          products.map((product) => (
                            <SelectItem key={product.id} value={product.id}>
                              {product.name} {product.color && `- ${product.color}`}
                            </SelectItem>
                          ))
                        ) : (
                          <SelectItem value="no-data" disabled>
                            {productsLoading ? "載入中..." : "沒有可用的產品"}
                          </SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-gray-700">倉庫 *</Label>
                    <Select 
                      value={roll.warehouse_id} 
                      onValueChange={(value) => updateInventoryRoll(index, 'warehouse_id', value)}
                      disabled={warehousesLoading}
                    >
                      <SelectTrigger className="border-gray-300 focus:border-blue-500 focus:ring-blue-500">
                        <SelectValue placeholder={warehousesLoading ? "載入中..." : "選擇倉庫"} />
                      </SelectTrigger>
                      <SelectContent>
                        {warehouses && warehouses.length > 0 ? (
                          warehouses.map((warehouse) => (
                            <SelectItem key={warehouse.id} value={warehouse.id}>
                              {warehouse.name}
                            </SelectItem>
                          ))
                        ) : (
                          <SelectItem value="no-data" disabled>
                            {warehousesLoading ? "載入中..." : "沒有可用的倉庫"}
                          </SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-gray-700">貨架位置</Label>
                    <Input
                      placeholder="例如：A-01-001"
                      value={roll.shelf}
                      onChange={(e) => updateInventoryRoll(index, 'shelf', e.target.value)}
                      className="border-gray-300 focus:border-blue-500 focus:ring-blue-500"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label className="text-gray-700">布卷編號 *</Label>
                    <Input
                      placeholder="輸入布卷編號..."
                      value={roll.roll_number}
                      onChange={(e) => updateInventoryRoll(index, 'roll_number', e.target.value)}
                      className="border-gray-300 focus:border-blue-500 focus:ring-blue-500"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label className="text-gray-700">重量 (公斤) *</Label>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="0.00"
                      value={roll.quantity || ''}
                      onChange={(e) => updateInventoryRoll(index, 'quantity', parseFloat(e.target.value) || 0)}
                      className="border-gray-300 focus:border-blue-500 focus:ring-blue-500"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label className="text-gray-700">品質等級 *</Label>
                    <Select 
                      value={roll.quality} 
                      onValueChange={(value: 'A' | 'B' | 'C' | 'D' | 'defective') => updateInventoryRoll(index, 'quality', value)}
                    >
                      <SelectTrigger className="border-gray-300 focus:border-blue-500 focus:ring-blue-500">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="A">A級</SelectItem>
                        <SelectItem value="B">B級</SelectItem>
                        <SelectItem value="C">C級</SelectItem>
                        <SelectItem value="D">D級</SelectItem>
                        <SelectItem value="defective">次品</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="col-span-3 space-y-2">
                    <Label className="text-gray-700">規格備註</Label>
                    <Input
                      placeholder="輸入布料規格或特殊說明..."
                      value={roll.specifications}
                      onChange={(e) => updateInventoryRoll(index, 'specifications', e.target.value)}
                      className="border-gray-300 focus:border-blue-500 focus:ring-blue-500"
                    />
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
              disabled={createInventoryMutation.isPending}
              className="bg-blue-600 text-white hover:bg-blue-700"
            >
              {createInventoryMutation.isPending ? '建立中...' : '建立入庫記錄'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
