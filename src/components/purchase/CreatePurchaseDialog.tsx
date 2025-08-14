import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useCurrentOrganization } from '@/hooks/useCurrentOrganization';
import { FactorySelector } from './FactorySelector';
import { OrderSelector } from './OrderSelector';
import { OrderProductsDisplay } from './OrderProductsDisplay';
import { PurchaseItemsSection } from './PurchaseItemsSection';
import { OrderProduct, InventoryInfo, PurchaseItem } from './types';

interface CreatePurchaseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: (purchase: any) => void;
}

export const CreatePurchaseDialog: React.FC<CreatePurchaseDialogProps> = ({
  open,
  onOpenChange,
  onSuccess,
}) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { organizationId } = useCurrentOrganization();
  
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
  
  // Validation errors
  const [validationErrors, setValidationErrors] = useState<{
    factoryId?: string;
    items?: { [index: number]: { product_id?: string; ordered_quantity?: string; unit_price?: string } };
  }>({});

  // Fetch factories for selection (organization-specific)
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
    },
    enabled: !!organizationId
  });

  // Fetch orders for selection (organization-specific)
  const { data: orders } = useQuery({
    queryKey: ['orders', organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        .select('id, order_number, note')
        .eq('organization_id', organizationId)
        .order('order_number');
      
      if (error) throw error;
      return data;
    },
    enabled: !!organizationId
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
          orders (id, order_number, note)
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

  // Fetch products for manual addition (organization-specific)
  const { data: products } = useQuery({
    queryKey: ['products', organizationId],
    queryFn: async () => {
      console.log('Fetching products...');
      const { data, error } = await supabase
        .from('products_new')
        .select('id, name, color, color_code')
        .eq('organization_id', organizationId)
        .order('name, color');
      
      if (error) {
        console.error('Error fetching products:', error);
        throw error;
      }
      console.log('Products fetched:', data?.length || 0, 'products');
      return data;
    },
    enabled: !!organizationId
  });

  // Get unique product names
  const uniqueProductNames = [...new Set(products?.map(p => p.name) || [])];
  console.log('Unique product names:', uniqueProductNames.length, uniqueProductNames);

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
        user_id: user.id,
        organization_id: organizationId
      };

      const { data: purchase, error: purchaseError } = await supabase
        .from('purchase_orders')
        .insert(insertData)
        .select(`
          *,
          factories (name),
          purchase_order_items (
            id,
            ordered_quantity,
            received_quantity,
            unit_price,
            specifications,
            products_new (name, color, color_code)
          ),
          purchase_order_relations (
            orders (order_number, note)
          )
        `)
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

      // Create order associations using the new purchase_order_relations table
      if (purchaseData.order_ids.length > 0) {
        const orderRelations = purchaseData.order_ids.map(orderId => ({
          purchase_order_id: purchase.id,
          order_id: orderId,
        }));

        const { error: relationsError } = await supabase
          .from('purchase_order_relations')
          .insert(orderRelations);

        if (relationsError) {
          console.error('Error creating order relations:', relationsError);
          throw relationsError;
        }

        // Update order status to 'factory_ordered' for associated orders
        const { error: orderUpdateError } = await supabase
          .from('orders')
          .update({ status: 'factory_ordered' })
          .in('id', purchaseData.order_ids);

        if (orderUpdateError) {
          console.error('Error updating order status:', orderUpdateError);
        }
      }

      // 重新查詢完整的採購單數據包含所有關聯
      const { data: completePurchase, error: queryError } = await supabase
        .from('purchase_orders')
        .select(`
          *,
          factories (name),
          purchase_order_items (
            id,
            ordered_quantity,
            received_quantity,
            unit_price,
            specifications,
            products_new (name, color, color_code)
          ),
          purchase_order_relations (
            orders (order_number, note)
          )
        `)
        .eq('id', purchase.id)
        .single();

      if (queryError) {
        console.error('Error fetching complete purchase data:', queryError);
        // 如果查詢失敗，返回基本數據
        return purchase;
      }

      return completePurchase;
    },
    onSuccess: async (purchase) => {
      toast({
        title: "成功",
        description: "採購單已成功建立並設為已下單狀態，關聯訂單狀態已更新為「已向工廠下單」",
      });
      
      // 更積極的查詢刷新 - 使用 refetchQueries 確保立即重新載入
      try {
        await Promise.all([
          queryClient.refetchQueries({ queryKey: ['purchases', organizationId] }),
          queryClient.refetchQueries({ queryKey: ['pending-inventory', organizationId] }),
          queryClient.refetchQueries({ queryKey: ['orders', organizationId] }),
        ]);
        console.log('All queries refetched successfully after purchase creation');
      } catch (error) {
        console.error('Error refetching queries after purchase creation:', error);
        // 如果 refetch 失敗，使用 invalidate 作為備用
        queryClient.invalidateQueries({ queryKey: ['purchases'] });
        queryClient.invalidateQueries({ queryKey: ['pending-inventory'] });
        queryClient.invalidateQueries({ queryKey: ['orders'] });
      }
      
      onOpenChange(false);
      resetForm();
      
      // 調用成功回調來打開新創建的採購單預覽
      if (onSuccess) {
        onSuccess(purchase);
      }
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
    setValidationErrors({});
  };

  const addItem = () => {
    const newItems = [...items, {
      product_id: '',
      ordered_quantity: 0,
      unit_price: 0,
      specifications: '',
      selected_product_name: ''
    }];
    console.log('CreatePurchaseDialog - Adding new item, new items array:', newItems);
    setItems(newItems);
  };

  const removeItem = (index: number) => {
    if (items.length > 1) {
      const newItems = items.filter((_, i) => i !== index);
      console.log('CreatePurchaseDialog - Removing item at index', index, 'new items array:', newItems);
      setItems(newItems);
      
      // Clean up UI state
      const newProductNameOpens = { ...productNameOpens };
      const newColorOpens = { ...colorOpens };
      delete newProductNameOpens[index];
      delete newColorOpens[index];
      setProductNameOpens(newProductNameOpens);
      setColorOpens(newColorOpens);
    }
  };

  const updateItem = (index: number, field: keyof PurchaseItem | Partial<PurchaseItem>, value?: any) => {
    setItems(prevItems => {
      const newItems = [...prevItems];
      if (typeof field === 'string') {
        // 單一欄位更新
        const updatedItem = { ...newItems[index], [field]: value };
        console.log('CreatePurchaseDialog - Updated single item field at index', index, ':', updatedItem);
        newItems[index] = updatedItem;
      } else {
        // 多個欄位更新 (field 是一個 Partial<PurchaseItem> 物件)
        const updatedItem = { ...newItems[index], ...field };
        console.log('CreatePurchaseDialog - Updated multiple item fields at index', index, ':', updatedItem);
        newItems[index] = updatedItem;
      }
      console.log('CreatePurchaseDialog - New items array after update:', newItems);
      return newItems;
    });
    console.log('CreatePurchaseDialog - setItems called with new array');
  };

  const validateForm = () => {
    const errors: typeof validationErrors = {};
    
    // Validate factory selection
    if (!factoryId) {
      errors.factoryId = "請選擇工廠";
    }
    
    // Validate items
    const itemErrors: { [index: number]: { product_id?: string; ordered_quantity?: string; unit_price?: string } } = {};
    let hasValidItem = false;
    
    items.forEach((item, index) => {
      const itemError: { product_id?: string; ordered_quantity?: string; unit_price?: string } = {};
      
      if (!item.product_id) {
        itemError.product_id = "請選擇產品和顏色";
      }
      if (!item.ordered_quantity || item.ordered_quantity <= 0) {
        itemError.ordered_quantity = "請輸入有效的數量";
      }
      if (!item.unit_price || item.unit_price <= 0) {
        itemError.unit_price = "請輸入有效的單價";
      }
      
      if (Object.keys(itemError).length > 0) {
        itemErrors[index] = itemError;
      } else {
        hasValidItem = true;
      }
    });
    
    if (!hasValidItem) {
      // If no valid items, ensure at least the first item shows all errors
      if (!itemErrors[0]) {
        itemErrors[0] = {};
      }
    }
    
    if (Object.keys(itemErrors).length > 0) {
      errors.items = itemErrors;
    }
    
    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = () => {
    if (!validateForm()) {
      return;
    }

    const validItems = items.filter(item => 
      item.product_id && 
      item.ordered_quantity > 0 && 
      item.unit_price > 0
    );

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
            <FactorySelector
              factories={factories}
              factoryId={factoryId}
              setFactoryId={(id) => {
                setFactoryId(id);
                if (validationErrors.factoryId) {
                  setValidationErrors(prev => ({ ...prev, factoryId: undefined }));
                }
              }}
              factoryOpen={factoryOpen}
              setFactoryOpen={setFactoryOpen}
              error={validationErrors.factoryId}
            />

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
          <OrderSelector
            orders={orders}
            selectedOrderIds={selectedOrderIds}
            setSelectedOrderIds={setSelectedOrderIds}
            orderSearchOpen={orderSearchOpen}
            setOrderSearchOpen={setOrderSearchOpen}
          />

          {/* Order Products Display */}
          <OrderProductsDisplay
            orderProducts={orderProducts}
            getInventoryInfo={getInventoryInfo}
          />

          {/* Manual Items Section */}
          <PurchaseItemsSection
            items={items}
            products={products}
            uniqueProductNames={uniqueProductNames}
            getColorVariants={getColorVariants}
            addItem={addItem}
            removeItem={removeItem}
            updateItem={(index, field, value) => {
              updateItem(index, field, value);
              // Clear validation errors for this field
              if (validationErrors.items?.[index]?.[field as keyof PurchaseItem]) {
                setValidationErrors(prev => ({
                  ...prev,
                  items: {
                    ...prev.items,
                    [index]: {
                      ...prev.items?.[index],
                      [field]: undefined
                    }
                  }
                }));
              }
            }}
            productNameOpens={productNameOpens}
            setProductNameOpens={setProductNameOpens}
            colorOpens={colorOpens}
            setColorOpens={setColorOpens}
            itemErrors={validationErrors.items}
          />

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
