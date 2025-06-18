
import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useCurrentOrganization } from '@/hooks/useCurrentOrganization';
import { Plus, Trash2 } from 'lucide-react';

interface CreateOrderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface OrderProduct {
  product_id: string;
  product_name: string;
  color: string;
  quantity: number;
  unit_price: number;
  subtotal: number;
}

export const CreateOrderDialog: React.FC<CreateOrderDialogProps> = ({
  open,
  onOpenChange,
}) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { organizationId } = useCurrentOrganization();
  
  const [customerId, setCustomerId] = useState('');
  const [selectedFactories, setSelectedFactories] = useState<string[]>([]);
  const [orderProducts, setOrderProducts] = useState<OrderProduct[]>([
    { product_id: '', product_name: '', color: '', quantity: 0, unit_price: 0, subtotal: 0 }
  ]);
  const [note, setNote] = useState('');

  // 獲取客戶列表
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
    }
  });

  // 獲取工廠列表
  const { data: factories } = useQuery({
    queryKey: ['factories', organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('factories')
        .select('id, name')
        .eq('organization_id', organizationId)
        .order('name');
      
      if (error) throw error;
      return data;
    }
  });

  // 獲取產品列表
  const { data: products } = useQuery({
    queryKey: ['products', organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products_new')
        .select('id, name, color')
        .eq('organization_id', organizationId)
        .eq('status', 'Available')
        .order('name, color');
      
      if (error) throw error;
      return data;
    }
  });

  const createOrderMutation = useMutation({
    mutationFn: async (orderData: {
      customer_id: string;
      factory_ids: string[];
      products: OrderProduct[];
      note?: string;
    }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      // 創建訂單
      const { data: order, error: orderError } = await supabase
        .from('orders')
        .insert({
          customer_id: orderData.customer_id,
          organization_id: organizationId,
          note: orderData.note,
          status: 'pending',
          user_id: user.id
        })
        .select()
        .single();

      if (orderError) throw orderError;

      // 創建訂單產品
      const orderProductsData = orderData.products.map(product => ({
        order_id: order.id,
        product_id: product.product_id,
        quantity: product.quantity,
        unit_price: product.unit_price,
        specifications: {}
      }));

      const { error: productsError } = await supabase
        .from('order_products')
        .insert(orderProductsData);

      if (productsError) throw productsError;

      // 關聯工廠
      if (orderData.factory_ids.length > 0) {
        const factoryRelations = orderData.factory_ids.map(factory_id => ({
          order_id: order.id,
          factory_id: factory_id
        }));

        const { error: factoryError } = await supabase
          .from('order_factories')
          .insert(factoryRelations);

        if (factoryError) throw factoryError;
      }

      return order;
    },
    onSuccess: () => {
      toast({
        title: "成功",
        description: "訂單已成功建立",
      });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      onOpenChange(false);
      resetForm();
    },
    onError: (error) => {
      console.error('Error creating order:', error);
      toast({
        title: "錯誤",
        description: "建立訂單時發生錯誤",
        variant: "destructive",
      });
    },
  });

  const resetForm = () => {
    setCustomerId('');
    setSelectedFactories([]);
    setOrderProducts([{ product_id: '', product_name: '', color: '', quantity: 0, unit_price: 0, subtotal: 0 }]);
    setNote('');
  };

  const addProduct = () => {
    setOrderProducts([...orderProducts, { product_id: '', product_name: '', color: '', quantity: 0, unit_price: 0, subtotal: 0 }]);
  };

  const removeProduct = (index: number) => {
    if (orderProducts.length > 1) {
      const newProducts = orderProducts.filter((_, i) => i !== index);
      setOrderProducts(newProducts);
    }
  };

  const updateProduct = (index: number, field: keyof OrderProduct, value: any) => {
    const newProducts = [...orderProducts];
    newProducts[index][field] = value;
    
    // 更新小計
    if (field === 'quantity' || field === 'unit_price') {
      newProducts[index].subtotal = newProducts[index].quantity * newProducts[index].unit_price;
    }
    
    // 如果選擇了產品，更新產品名稱和顏色
    if (field === 'product_id') {
      const selectedProduct = products?.find(p => p.id === value);
      if (selectedProduct) {
        newProducts[index].product_name = selectedProduct.name;
        newProducts[index].color = selectedProduct.color || '';
      }
    }
    
    setOrderProducts(newProducts);
  };

  const getTotalAmount = () => {
    return orderProducts.reduce((sum, product) => sum + product.subtotal, 0);
  };

  const handleSubmit = () => {
    if (!customerId) {
      toast({
        title: "錯誤",
        description: "請選擇客戶",
        variant: "destructive",
      });
      return;
    }

    const validProducts = orderProducts.filter(product => 
      product.product_id && product.quantity > 0 && product.unit_price > 0
    );

    if (validProducts.length === 0) {
      toast({
        title: "錯誤",
        description: "請至少新增一個有效的產品項目",
        variant: "destructive",
      });
      return;
    }

    createOrderMutation.mutate({
      customer_id: customerId,
      factory_ids: selectedFactories,
      products: validProducts,
      note: note || undefined
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>新增訂單</DialogTitle>
          <DialogDescription>
            建立新的客戶訂單
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* 訂單編號 */}
          <div className="bg-blue-50 p-4 rounded-lg">
            <Label className="text-sm font-medium text-blue-800">訂單編號（自動生成）</Label>
            <p className="text-lg font-bold text-blue-900">25K0618-009</p>
            <p className="text-xs text-blue-700">格式：年份K月份日期-流水號</p>
          </div>

          {/* 基本資訊 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="customer">客戶 *</Label>
              <Select value={customerId} onValueChange={setCustomerId}>
                <SelectTrigger>
                  <SelectValue placeholder="選擇客戶..." />
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
          </div>

          {/* 關聯工廠 */}
          <div className="space-y-4">
            <Label className="text-base font-medium">關聯工廠（可選擇多個）</Label>
            <Select value="" onValueChange={(value) => {
              if (value && !selectedFactories.includes(value)) {
                setSelectedFactories([...selectedFactories, value]);
              }
            }}>
              <SelectTrigger>
                <SelectValue placeholder="選擇工廠..." />
              </SelectTrigger>
              <SelectContent>
                {factories?.filter(f => !selectedFactories.includes(f.id)).map((factory) => (
                  <SelectItem key={factory.id} value={factory.id}>
                    {factory.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            
            {selectedFactories.length === 0 ? (
              <p className="text-sm text-gray-500">尚未選擇工廠</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {selectedFactories.map((factoryId) => {
                  const factory = factories?.find(f => f.id === factoryId);
                  return (
                    <div key={factoryId} className="bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-sm flex items-center gap-2">
                      {factory?.name}
                      <button
                        type="button"
                        onClick={() => setSelectedFactories(selectedFactories.filter(id => id !== factoryId))}
                        className="text-blue-600 hover:text-blue-800"
                      >
                        ×
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 產品明細 */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Label className="text-base font-medium">產品明細 *</Label>
              <Button type="button" onClick={addProduct} variant="outline" size="sm">
                <Plus className="h-4 w-4 mr-2" />
                新增產品
              </Button>
            </div>

            <div className="space-y-4">
              {orderProducts.map((product, index) => (
                <div key={index} className="p-4 border rounded-lg space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="font-medium">產品 {index + 1}</h4>
                    {orderProducts.length > 1 && (
                      <Button
                        type="button"
                        onClick={() => removeProduct(index)}
                        variant="outline"
                        size="sm"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div className="space-y-2">
                      <Label>產品名稱 *</Label>
                      <Select 
                        value={product.product_id} 
                        onValueChange={(value) => updateProduct(index, 'product_id', value)}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="選擇產品..." />
                        </SelectTrigger>
                        <SelectContent>
                          {products?.map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.name} {p.color ? `- ${p.color}` : ''}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label>顏色/色碼 *</Label>
                      <Input
                        value={product.color}
                        onChange={(e) => updateProduct(index, 'color', e.target.value)}
                        placeholder="選擇顏色/色碼..."
                        readOnly
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>公斤數 *</Label>
                      <Input
                        type="number"
                        step="0.001"
                        value={product.quantity || ''}
                        onChange={(e) => updateProduct(index, 'quantity', parseFloat(e.target.value) || 0)}
                        placeholder="0"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>單價（每公斤）*</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={product.unit_price || ''}
                        onChange={(e) => updateProduct(index, 'unit_price', parseFloat(e.target.value) || 0)}
                        placeholder="0"
                      />
                    </div>
                  </div>
                  
                  <div className="text-right">
                    <span className="font-medium">小計: ${product.subtotal.toFixed(2)}</span>
                  </div>
                </div>
              ))}
            </div>

            <div className="text-right text-lg font-bold">
              訂單總計: ${getTotalAmount().toFixed(2)}
            </div>
          </div>

          {/* 訂單備註 */}
          <div className="space-y-2">
            <Label htmlFor="note">訂單備註</Label>
            <Textarea
              id="note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="輸入訂單備註..."
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button 
            onClick={handleSubmit}
            disabled={createOrderMutation.isPending}
          >
            {createOrderMutation.isPending ? '建立中...' : '建立訂單'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
