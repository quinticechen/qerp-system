import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { OrderBasicInfo, OrderProductSection } from './components';
import { CreateCustomerDialog } from '../common/CreateCustomerDialog';
import { CreateFactoryDialog } from '../common/CreateFactoryDialog';
import { CreateProductDialog } from '../product/CreateProductDialog';
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
  
  // Dialog states for creating new entities
  const [isCreateCustomerOpen, setIsCreateCustomerOpen] = useState(false);
  const [isCreateFactoryOpen, setIsCreateFactoryOpen] = useState(false);
  const [isCreateProductOpen, setIsCreateProductOpen] = useState(false);

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
    },
    enabled: !!organizationId
  });

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

  // Handlers for creating new entities
  const handleCustomerCreated = () => {
    queryClient.invalidateQueries({ queryKey: ['customers', organizationId] });
    setIsCreateCustomerOpen(false);
  };

  const handleFactoryCreated = () => {
    queryClient.invalidateQueries({ queryKey: ['factories', organizationId] });
    setIsCreateFactoryOpen(false);
  };

  const handleProductCreated = () => {
    queryClient.invalidateQueries({ queryKey: ['all-products', organizationId] });
    setIsCreateProductOpen(false);
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
          <OrderBasicInfo
            generatedOrderNumber={generatedOrderNumber}
            selectedCustomer={selectedCustomer}
            onCustomerChange={setSelectedCustomer}
            selectedFactoryIds={selectedFactoryIds}
            onFactoriesChange={setSelectedFactoryIds}
            customers={customers || []}
            onCreateCustomer={() => setIsCreateCustomerOpen(true)}
            onCreateFactory={() => setIsCreateFactoryOpen(true)}
          />

          <OrderProductSection
            products={products}
            allProducts={allProducts || []}
            onAddProduct={addProduct}
            onRemoveProduct={removeProduct}
            onUpdateProduct={updateProduct}
            onCreateProduct={() => setIsCreateProductOpen(true)}
            note={note}
            onNoteChange={setNote}
          />
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

      {/* Create dialogs */}
      <CreateCustomerDialog
        open={isCreateCustomerOpen}
        onOpenChange={setIsCreateCustomerOpen}
        onCustomerCreated={handleCustomerCreated}
      />
      
      <CreateFactoryDialog
        open={isCreateFactoryOpen}
        onOpenChange={setIsCreateFactoryOpen}
        onFactoryCreated={handleFactoryCreated}
      />
      
      <CreateProductDialog
        open={isCreateProductOpen}
        onOpenChange={setIsCreateProductOpen}
        onProductCreated={handleProductCreated}
      />
    </Dialog>
  );
};