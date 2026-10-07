import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useCurrentOrganization } from '@/hooks/useCurrentOrganization';

// Shelves are stored in the `warehouses` table (selected as "倉庫" when creating inventory).

export interface Shelf {
  id: string;
  name: string;
  location: string | null;
  rollCount: number;
  totalQuantity: number;
}

export interface ShelfProduct {
  productId: string;
  productName: string;
  color: string | null;
  colorCode: string | null;
  rollCount: number;
  totalQuantity: number;
  qualities: string[];
}

export const useShelves = () => {
  const { organizationId, hasOrganization } = useCurrentOrganization();

  return useQuery({
    queryKey: ['shelves', organizationId],
    queryFn: async (): Promise<Shelf[]> => {
      if (!organizationId) return [];

      const { data, error } = await supabase
        .from('warehouses')
        .select('id, name, location, inventory_rolls(current_quantity)')
        .eq('organization_id', organizationId)
        .order('name');

      if (error) throw error;

      return (data || []).map((warehouse) => {
        const stockedRolls = (warehouse.inventory_rolls || []).filter(
          (roll) => roll.current_quantity > 0
        );
        return {
          id: warehouse.id,
          name: warehouse.name,
          location: warehouse.location,
          rollCount: stockedRolls.length,
          totalQuantity: stockedRolls.reduce((sum, roll) => sum + roll.current_quantity, 0),
        };
      });
    },
    enabled: hasOrganization,
  });
};

export const useShelfProducts = (shelfId: string | null) => {
  return useQuery({
    queryKey: ['shelf-products', shelfId],
    queryFn: async (): Promise<ShelfProduct[]> => {
      if (!shelfId) return [];

      const { data, error } = await supabase
        .from('inventory_rolls')
        .select('product_id, current_quantity, quality, products_new:product_id (name, color, color_code)')
        .eq('warehouse_id', shelfId)
        .gt('current_quantity', 0);

      if (error) throw error;

      const productMap = new Map<string, ShelfProduct>();
      for (const roll of data || []) {
        const existing = productMap.get(roll.product_id);
        if (existing) {
          existing.rollCount += 1;
          existing.totalQuantity += roll.current_quantity;
          if (!existing.qualities.includes(roll.quality)) existing.qualities.push(roll.quality);
        } else {
          productMap.set(roll.product_id, {
            productId: roll.product_id,
            productName: roll.products_new?.name || '未知產品',
            color: roll.products_new?.color ?? null,
            colorCode: roll.products_new?.color_code ?? null,
            rollCount: 1,
            totalQuantity: roll.current_quantity,
            qualities: [roll.quality],
          });
        }
      }

      return Array.from(productMap.values()).sort((a, b) =>
        a.productName.localeCompare(b.productName, 'zh-Hant')
      );
    },
    enabled: !!shelfId,
  });
};

export const useCreateShelf = () => {
  const queryClient = useQueryClient();
  const { organizationId } = useCurrentOrganization();

  return useMutation({
    mutationFn: async (name: string) => {
      if (!organizationId) throw new Error('請先選擇組織');
      const { error } = await supabase.from('warehouses').insert({ name, organization_id: organizationId });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shelves'] });
      queryClient.invalidateQueries({ queryKey: ['warehouses'] });
    },
  });
};

export const useRenameShelf = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const { error } = await supabase.from('warehouses').update({ name }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shelves'] });
      queryClient.invalidateQueries({ queryKey: ['warehouses'] });
    },
  });
};
