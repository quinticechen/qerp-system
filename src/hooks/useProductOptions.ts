import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface ProductOption {
  id: string;
  name: string;
  color: string | null;
}

export const productLabel = (product: Pick<ProductOption, 'name' | 'color'>) =>
  product.color ? `${product.name} - ${product.color}` : product.name;

// Products of the organization that owns the document being edited
export const useProductOptions = (organizationId: string | null | undefined) =>
  useQuery({
    queryKey: ['product-options', organizationId],
    queryFn: async (): Promise<ProductOption[]> => {
      const { data, error } = await supabase
        .from('products_new')
        .select('id, name, color')
        .eq('organization_id', organizationId!)
        .order('name');
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!organizationId,
  });
