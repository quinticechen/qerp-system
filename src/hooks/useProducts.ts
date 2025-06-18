
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useCurrentOrganization } from '@/hooks/useCurrentOrganization';

export type Product = {
  id: string;
  name: string;
  category: string;
  color: string | null;
  color_code: string | null;
  stock_thresholds: number | null;
  status: 'Available' | 'Unavailable';
  unit_of_measure: string;
  user_id: string;
  organization_id: string;
  created_at: string;
  updated_at: string;
};

export type ProductFormData = {
  name: string;
  category: string;
  color?: string;
  color_code?: string;
  stock_thresholds?: number;
  status: 'Available' | 'Unavailable';
  unit_of_measure: string;
};

export const useProducts = () => {
  const { toast } = useToast();
  const { organizationId } = useCurrentOrganization();

  const { data: products = [], isLoading, refetch } = useQuery({
    queryKey: ['products', organizationId],
    queryFn: async () => {
      if (!organizationId) return [];

      const { data, error } = await supabase
        .from('products_new')
        .select('*')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching products:', error);
        throw error;
      }

      return data as Product[];
    },
    enabled: !!organizationId
  });

  const createProduct = async (productData: ProductFormData) => {
    if (!organizationId) {
      toast({
        title: "錯誤",
        description: "請先選擇組織",
        variant: "destructive",
      });
      return false;
    }

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast({
          title: "錯誤",
          description: "請先登入",
          variant: "destructive",
        });
        return false;
      }

      const { error } = await supabase
        .from('products_new')
        .insert({
          ...productData,
          user_id: user.id,
          organization_id: organizationId,
        });

      if (error) throw error;

      toast({
        title: "新增成功",
        description: "產品已成功新增",
      });

      await refetch();
      return true;
    } catch (error: any) {
      console.error('Failed to create product:', error);
      toast({
        title: "新增失敗",
        description: error.message,
        variant: "destructive",
      });
      return false;
    }
  };

  const updateProduct = async (id: string, productData: Partial<ProductFormData>) => {
    try {
      const { error } = await supabase
        .from('products_new')
        .update(productData)
        .eq('id', id);

      if (error) throw error;

      toast({
        title: "更新成功",
        description: "產品已成功更新",
      });

      await refetch();
      return true;
    } catch (error: any) {
      console.error('Failed to update product:', error);
      toast({
        title: "更新失敗",
        description: error.message,
        variant: "destructive",
      });
      return false;
    }
  };

  return {
    products,
    loading: isLoading,
    createProduct,
    updateProduct,
    reload: () => refetch(),
  };
};
