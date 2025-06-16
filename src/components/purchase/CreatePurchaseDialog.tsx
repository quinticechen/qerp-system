import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { FactorySelector } from './FactorySelector';
import { OrderSelector } from './OrderSelector';
import { OrderProductsDisplay } from './OrderProductsDisplay';
import { PurchaseItemsSection } from './PurchaseItemsSection';
import { OrderProduct, InventoryInfo, PurchaseItem } from './types';

interface CreatePurchaseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
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
      console.log('Fetching products...');
      const { data, error } = await supabase
        .from('products_new')
        .select('id, name, color, color_code')
        .order('name, color');
      
      if (error) {
        console.error('Error fetching products:', error);
        throw error;
      }
      console.log('Products fetched:', data?.length || 0, 'products');
      return data;
    }
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
    console.log('updateItem called:', { index, field, value });
    console.log('Current items before update:', items);
    
    const updatedItems = [...items];
    updatedItems[index] = { ...updatedItems[index], [field]: value };
    
    console.log('Updated items:', updatedItems);
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
            <FactorySelector
              factories={factories}
              factoryId={factoryId}
              setFactoryId={setFactoryId}
              factoryOpen={factoryOpen}
              setFactoryOpen={setFactoryOpen}
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
            updateItem={updateItem}
            productNameOpens={productNameOpens}
            setProductNameOpens={setProductNameOpens}
            colorOpens={colorOpens}
            setColorOpens={setColorOpens}
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
