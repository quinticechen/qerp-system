
import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Plus, Trash } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Combobox } from '@/components/ui/combobox';
import { FactorySelector } from './FactorySelector';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useCurrentOrganization } from '@/hooks/useCurrentOrganization';

interface CreateOrderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface Product {
  id: string;
  name: string;
  color: string | null;
  color_code: string | null;
}

interface OrderProduct {
  base_product_name: string;
  product_id: string;
  quantity: number;
  unit_price: number;
  specifications: any;
}

export const CreateOrderDialog: React.FC<CreateOrderDialogProps> = ({
  open,
  onOpenChange,
}) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { organizationId } = useCurrentOrganization();
  
  const [selectedCustomer, setSelectedCustomer] = useState('');
  const [selectedFactoryIds, setSelectedFactoryIds] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [generatedOrderNumber, setGeneratedOrderNumber] = useState('');
  const [products, setProducts] = useState<OrderProduct[]>([{
    base_product_name: '',
    product_id: '',
    quantity: 0,
    unit_price: 0,
    specifications: {}
  }]);

  // Generate next order number preview when dialog opens
  useEffect(() => {
    if (open) {
      // 獲取下一個訂單編號的預覽
      const fetchNextOrderNumber = async () => {
        try {
          // 獲取今日最新的訂單編號來計算下一個序號
          const now = new Date();
          const year = now.getFullYear().toString().slice(-2);
          const month = String(now.getMonth() + 1).padStart(2, '0');
          const day = String(now.getDate()).padStart(2, '0');
          const todayPrefix = `${year}K${month}${day}-`;
          
          const { data: latestOrders } = await supabase
            .from('orders')
            .select('order_number')
            .like('order_number', `${todayPrefix}%`)
            .order('created_at', { ascending: false })
            .limit(1);
          
          let nextSeq = 1;
          if (latestOrders && latestOrders.length > 0) {
            const latestNumber = latestOrders[0].order_number;
            const seqPart = latestNumber.split('-')[1];
            if (seqPart) {
              nextSeq = parseInt(seqPart) + 1;
            }
          }
          
          const formattedSeq = String(nextSeq).padStart(3, '0');
          const preview = `${todayPrefix}${formattedSeq}`;
          
          setGeneratedOrderNumber(preview);
        } catch (error) {
          // 如果無法獲取，使用預設預覽
          const now = new Date();
          const year = now.getFullYear().toString().slice(-2);
          const month = String(now.getMonth() + 1).padStart(2, '0');
          const day = String(now.getDate()).padStart(2, '0');
          const preview = `${year}K${month}${day}-001`;
          setGeneratedOrderNumber(preview);
        }
      };
      
      fetchNextOrderNumber();
    }
  }, [open]);

  // Fetch customers
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

  // Fetch all products
  const { data: allProducts } = useQuery({
    queryKey: ['all-products', organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products_new')
        .select('id, name, color, color_code')
        .eq('organization_id', organizationId)
        .eq('status', 'Available')
        .order('name, color, color_code');
      
      if (error) throw error;
      return data as Product[];
    }
  });

  // Get unique product names
  const uniqueProductNames = [...new Set(allProducts?.map(p => p.name))];

  // Get color variants for a specific product name
  const getColorVariants = (productName: string) => {
    return allProducts?.filter(p => p.name === productName) || [];
  };

  const createOrderMutation = useMutation({
    mutationFn: async (orderData: {
      customer_id: string;
      factory_ids: string[];
      note: string;
      products: OrderProduct[];
    }) => {
      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('使用者未登入');

      // Create order (order number will be auto-generated by trigger)
      const { data: order, error: orderError } = await supabase
        .from('orders')
        .insert({
          customer_id: orderData.customer_id,
          organization_id: organizationId,
          user_id: user.id,
          note: orderData.note,
          status: 'pending' as const,
          payment_status: 'unpaid' as const,
          shipping_status: 'not_started' as const,
          order_number: 'temp' // Temporary value, will be overwritten by trigger
        })
        .select()
        .single();

      if (orderError) {
        console.error('Order creation error:', orderError);
        throw orderError;
      }

      // Create order products
      const orderProducts = orderData.products.map(product => ({
        order_id: order.id,
        product_id: product.product_id,
        quantity: product.quantity,
        unit_price: product.unit_price,
        specifications: product.specifications,
      }));

      const { error: productsError } = await supabase
        .from('order_products')
        .insert(orderProducts);

      if (productsError) {
        console.error('Order products creation error:', productsError);
        throw productsError;
      }

      // Create factory associations if any
      if (orderData.factory_ids.length > 0) {
        const factoryAssociations = orderData.factory_ids.map(factoryId => ({
          order_id: order.id,
          factory_id: factoryId,
        }));

        const { error: factoriesError } = await supabase
          .from('order_factories')
          .insert(factoryAssociations);

        if (factoriesError) {
          console.error('Order factories creation error:', factoriesError);
          throw factoriesError;
        }
      }

      return order;
    },
    onSuccess: (order) => {
      toast({
        title: "成功",
        description: `訂單 ${order.order_number} 已成功建立`,
      });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      onOpenChange(false);
      resetForm();
    },
    onError: (error: any) => {
      console.error('Error creating order:', error);
      toast({
        title: "錯誤",
        description: error.message || "建立訂單時發生錯誤",
        variant: "destructive",
      });
    },
  });

  const resetForm = () => {
    setSelectedCustomer('');
    setSelectedFactoryIds([]);
    setNote('');
    setGeneratedOrderNumber('');
    setProducts([{
      base_product_name: '',
      product_id: '',
      quantity: 0,
      unit_price: 0,
      specifications: {}
    }]);
  };

  const addProduct = () => {
    setProducts([...products, {
      base_product_name: '',
      product_id: '',
      quantity: 0,
      unit_price: 0,
      specifications: {}
    }]);
  };

  const removeProduct = (index: number) => {
    if (products.length > 1) {
      setProducts(products.filter((_, i) => i !== index));
    }
  };

  const updateProduct = (index: number, field: keyof OrderProduct, value: any) => {
    const updatedProducts = [...products];
    updatedProducts[index] = { ...updatedProducts[index], [field]: value };
    
    // If base product name changes, reset product_id
    if (field === 'base_product_name') {
      updatedProducts[index].product_id = '';
    }
    
    setProducts(updatedProducts);
  };

  const handleSubmit = () => {
    if (!selectedCustomer) {
      toast({
        title: "錯誤",
        description: "請選擇客戶",
        variant: "destructive",
      });
      return;
    }

    const validProducts = products.filter(p => p.product_id && p.quantity > 0 && p.unit_price > 0);
    if (validProducts.length === 0) {
      toast({
        title: "錯誤",
        description: "請至少添加一個有效的產品",
        variant: "destructive",
      });
      return;
    }

    createOrderMutation.mutate({
      customer_id: selectedCustomer,
      factory_ids: selectedFactoryIds,
      note,
      products: validProducts,
    });
  };

  // Prepare customer options for combobox
  const customerOptions = customers?.map(customer => ({
    value: customer.id,
    label: customer.name,
  })) || [];

  // Prepare product name options for combobox
  const productNameOptions = uniqueProductNames.map(name => ({
    value: name,
    label: name,
  }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-gray-900">新增訂單</DialogTitle>
          <DialogDescription className="text-gray-700">
            建立新的客戶訂單
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Order Number Preview */}
          <div className="bg-blue-50 p-4 rounded-lg">
            <Label className="text-gray-800 font-semibold">訂單編號 (自動生成)</Label>
            <div className="text-lg font-mono text-blue-800 mt-1">{generatedOrderNumber}</div>
            <div className="text-xs text-gray-600 mt-1">格式：年份K月份日期-流水號</div>
          </div>

          {/* Customer Selection */}
          <div className="space-y-2">
            <Label className="text-gray-800">客戶 *</Label>
            <Combobox
              options={customerOptions}
              value={selectedCustomer}
              onValueChange={setSelectedCustomer}
              placeholder="選擇客戶..."
              searchPlaceholder="搜尋客戶..."
              emptyText="未找到客戶"
              className="w-full"
            />
          </div>

          {/* Factory Selection */}
          <FactorySelector 
            selectedFactoryIds={selectedFactoryIds}
            onFactoriesChange={setSelectedFactoryIds}
          />

          {/* Products Section */}
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <Label className="text-gray-800">產品明細 *</Label>
              <Button type="button" variant="outline" size="sm" onClick={addProduct}>
                <Plus className="h-4 w-4 mr-2" />
                新增產品
              </Button>
            </div>

            {products.map((product, index) => {
              const colorVariants = getColorVariants(product.base_product_name);
              // 改善顏色選項顯示：每個色碼都是獨立選項，同時顯示顏色和色碼
              const colorOptions = colorVariants.map(variant => {
                const displayText = variant.color && variant.color_code 
                  ? `${variant.color} (${variant.color_code})`
                  : variant.color || variant.color_code || '無顏色';
                
                return {
                  value: variant.id,
                  label: displayText,
                  extra: variant.color_code ? (
                    <div className="flex items-center space-x-2">
                      <div 
                        className="w-3 h-3 rounded border border-gray-400"
                        style={{ backgroundColor: variant.color_code }}
                      ></div>
                      <span className="text-xs text-gray-500">{variant.color_code}</span>
                    </div>
                  ) : null,
                };
              });
              
              return (
                <Card key={index} className="border-gray-200">
                  <CardContent className="p-4">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div className="space-y-2">
                        <Label className="text-gray-800">產品名稱 *</Label>
                        <Combobox
                          options={productNameOptions}
                          value={product.base_product_name}
                          onValueChange={(value) => updateProduct(index, 'base_product_name', value)}
                          placeholder="選擇產品..."
                          searchPlaceholder="搜尋產品..."
                          emptyText="未找到產品"
                          className="w-full"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label className="text-gray-800">顏色/色碼 *</Label>
                        <Combobox
                          options={colorOptions}
                          value={product.product_id}
                          onValueChange={(value) => updateProduct(index, 'product_id', value)}
                          placeholder="選擇顏色/色碼..."
                          searchPlaceholder="搜尋顏色或色碼..."
                          emptyText="未找到顏色"
                          disabled={!product.base_product_name}
                          className="w-full"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label className="text-gray-800">公斤數 *</Label>
                        <Input
                          type="number"
                          value={product.quantity}
                          onChange={(e) => updateProduct(index, 'quantity', parseFloat(e.target.value) || 0)}
                          className="border-gray-200 text-gray-900"
                          min="0"
                          step="0.01"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label className="text-gray-800">單價 (每公斤) *</Label>
                        <Input
                          type="number"
                          value={product.unit_price}
                          onChange={(e) => updateProduct(index, 'unit_price', parseFloat(e.target.value) || 0)}
                          className="border-gray-200 text-gray-900"
                          min="0"
                          step="0.01"
                        />
                      </div>
                    </div>

                    <div className="mt-4 flex justify-between items-center">
                      <div className="text-sm text-gray-700">
                        小計: ${(product.quantity * product.unit_price).toLocaleString()}
                      </div>
                      {products.length > 1 && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => removeProduct(index)}
                          className="text-red-600 hover:text-red-800"
                        >
                          <Trash className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Order Note */}
          <div className="space-y-2">
            <Label htmlFor="note" className="text-gray-800">訂單備註</Label>
            <Textarea
              id="note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="輸入訂單備註..."
              className="border-gray-200 text-gray-900"
            />
          </div>

          {/* Order Total */}
          <div className="bg-gray-50 p-4 rounded-lg">
            <div className="text-lg font-semibold text-gray-900">
              訂單總計: ${products.reduce((total, p) => total + (p.quantity * p.unit_price), 0).toLocaleString()}
            </div>
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
