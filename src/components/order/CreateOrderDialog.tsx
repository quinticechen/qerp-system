import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { OrderBasicInfo, OrderProductSection } from './components';
import { CreateCustomerDialog } from '../common/CreateCustomerDialog';
import { CreateFactoryDialog } from '../common/CreateFactoryDialog';
import { CreateProductDialog } from '../product/CreateProductDialog';
import { supabase } from '@/integrations/supabase/client';
import { createOrder } from '@/lib/api/orders';
import { apiErrorMessage } from '@/lib/api/client';
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
  
  // Validation errors
  const [validationErrors, setValidationErrors] = useState<{
    selectedCustomer?: string;
    products?: { [index: number]: { product_id?: string; quantity?: string; unit_price?: string } };
  }>({});

  // Generate next order number preview when dialog opens
  useEffect(() => {
    if (open) {
      // 獲取下一個訂單編號的預覽
      // Preview of the next number: B + date + four-digit sequence, counted per organization.
      // The database assigns the real number when the order is created.
      const fetchNextOrderNumber = async () => {
        const now = new Date();
        const todayPrefix = `B${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
        try {
          const { data: latestOrders } = await supabase
            .from('orders')
            .select('order_number')
            .eq('organization_id', organizationId)
            .like('order_number', `${todayPrefix}%`)
            .order('order_number', { ascending: false })
            .limit(1);

          const lastSequence = Number(latestOrders?.[0]?.order_number.slice(todayPrefix.length)) || 0;
          setGeneratedOrderNumber(`${todayPrefix}${String(lastSequence + 1).padStart(4, '0')}`);
        } catch (error) {
          setGeneratedOrderNumber(`${todayPrefix}0001`);
        }
      };
      
      fetchNextOrderNumber();
    }
  }, [open]);

  // Fetch customers; disabled ones cannot get new orders
  const { data: customers } = useQuery({
    queryKey: ['customers', organizationId, 'active'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('customers')
        .select('id, name')
        .eq('organization_id', organizationId)
        .eq('is_active', true)
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
      if (!organizationId) throw new Error('請先選擇組織');
      // One call creates the order, its lines and factories together and numbers it
      return createOrder(organizationId, {
        customerId: orderData.customer_id,
        items: orderData.products.map((product) => ({
          product_id: product.product_id,
          quantity: product.quantity,
          unit_price: product.unit_price,
          specifications: product.specifications,
        })),
        factoryIds: orderData.factory_ids,
        note: orderData.note,
      });
    },
    onSuccess: (result) => {
      toast({
        title: "成功",
        description: `訂單 ${result.number} 已成功建立`,
      });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      onOpenChange(false);
      resetForm();
    },
    onError: (error: Error) => {
      console.error('Error creating order:', error);
      toast({
        title: "錯誤",
        description: apiErrorMessage(error, "建立訂單時發生錯誤"),
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
    setValidationErrors({});
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

  const validateForm = () => {
    const errors: typeof validationErrors = {};
    
    // Validate customer selection
    if (!selectedCustomer) {
      errors.selectedCustomer = "請選擇客戶";
    }
    
    // Validate products
    const productErrors: { [index: number]: { product_id?: string; quantity?: string; unit_price?: string } } = {};
    let hasValidProduct = false;
    
    products.forEach((product, index) => {
      const productError: { product_id?: string; quantity?: string; unit_price?: string } = {};
      
      if (!product.product_id) {
        productError.product_id = "請選擇產品和顏色";
      }
      if (!product.quantity || product.quantity <= 0) {
        productError.quantity = "請輸入有效的數量";
      }
      if (!product.unit_price || product.unit_price <= 0) {
        productError.unit_price = "請輸入有效的單價";
      }
      
      if (Object.keys(productError).length > 0) {
        productErrors[index] = productError;
      } else {
        hasValidProduct = true;
      }
    });
    
    if (!hasValidProduct) {
      // If no valid products, ensure at least the first product shows all errors
      if (!productErrors[0]) {
        productErrors[0] = {};
      }
    }
    
    if (Object.keys(productErrors).length > 0) {
      errors.products = productErrors;
    }
    
    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = () => {
    if (!validateForm()) {
      return;
    }

    const validProducts = products.filter(p => p.product_id && p.quantity > 0 && p.unit_price > 0);
    
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
            onCustomerChange={(value) => {
              setSelectedCustomer(value);
              if (validationErrors.selectedCustomer) {
                setValidationErrors(prev => ({ ...prev, selectedCustomer: undefined }));
              }
            }}
            selectedFactoryIds={selectedFactoryIds}
            onFactoriesChange={setSelectedFactoryIds}
            customers={customers || []}
            onCreateCustomer={() => setIsCreateCustomerOpen(true)}
            onCreateFactory={() => setIsCreateFactoryOpen(true)}
            customerError={validationErrors.selectedCustomer}
          />

          <OrderProductSection
            products={products}
            allProducts={allProducts || []}
            onAddProduct={addProduct}
            onRemoveProduct={removeProduct}
            onUpdateProduct={(index, field, value) => {
              updateProduct(index, field, value);
              // Clear validation errors for this field
              if (validationErrors.products?.[index]?.[field as keyof OrderProduct]) {
                setValidationErrors(prev => ({
                  ...prev,
                  products: {
                    ...prev.products,
                    [index]: {
                      ...prev.products?.[index],
                      [field]: undefined
                    }
                  }
                }));
              }
            }}
            onCreateProduct={() => setIsCreateProductOpen(true)}
            note={note}
            onNoteChange={setNote}
            productErrors={validationErrors.products}
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