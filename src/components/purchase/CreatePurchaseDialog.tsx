import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RecordDialog } from '@/components/common/RecordDialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useCurrentOrganization } from '@/hooks/useCurrentOrganization';
import { createPurchaseOrder } from '@/lib/api/purchases';
import { apiErrorMessage } from '@/lib/api/client';
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

  // Fetch factories for selection (organization-specific); disabled ones cannot get new purchase orders
  const { data: factories } = useQuery({
    queryKey: ['factories', organizationId, 'active'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('factories')
        .select('id, name')
        .eq('organization_id', organizationId)
        .eq('is_active', true)
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
    queryKey: ['inventory-info', organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inventory_summary')
        .select('product_id, total_stock, a_grade_stock, b_grade_stock, c_grade_stock, d_grade_stock, defective_stock')
        .eq('organization_id', organizationId!);
      
      if (error) throw error;
      return data as InventoryInfo[];
    },
    enabled: !!organizationId
  });

  // Colors that can be purchased: the color and its product are both enabled
  const { data: products } = useQuery({
    queryKey: ['all-products', organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('product_catalog')
        .select('color_id, product_name, color, color_code')
        .eq('organization_id', organizationId!)
        .eq('product_is_active', true)
        .eq('color_is_active', true)
        .order('product_name')
        .order('color')
        .order('color_code');
      if (error) throw error;
      return (data ?? []).map((row) => ({
        id: row.color_id as string,
        name: row.product_name as string,
        color: row.color,
        color_code: row.color_code,
      }));
    },
    enabled: !!organizationId
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
      if (!organizationId) throw new Error('請先選擇組織');

      // One call writes the purchase order, its items and linked orders, and marks the orders 已向工廠下單
      const result = await createPurchaseOrder(organizationId, {
        factoryId: purchaseData.factory_id,
        orderIds: purchaseData.order_ids,
        expectedArrivalDate: purchaseData.expected_arrival_date,
        note: purchaseData.note,
        items: purchaseData.items.map((item) => ({
          product_id: item.product_id,
          ordered_quantity: item.ordered_quantity,
          unit_price: item.unit_price,
          specifications: item.specifications ? JSON.parse(item.specifications) : null,
        })),
      });

      // The complete purchase order, for the preview that opens next
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
        .eq('id', result.id!)
        .single();

      if (queryError) throw queryError;
      return completePurchase;
    },
    onSuccess: async (purchase) => {
      toast({
        title: "成功",
        description: `採購單 ${purchase.po_number} 已建立，關聯訂單已更新為「已向工廠下單」`,
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
        description: apiErrorMessage(error, '建立採購單時發生錯誤'),
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
    <>
      <RecordDialog
        open={open}
        onOpenChange={onOpenChange}
        mode="create"
        title="新增採購單"
        description="建立新的採購單並添加產品項目"
        size="xl"
        onSubmit={handleSubmit}
        submitting={createPurchaseMutation.isPending}
        submitLabel="建立採購單"
      >
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
      </RecordDialog>
    </>
  );
};
