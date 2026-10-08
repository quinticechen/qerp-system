import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useCurrentOrganization } from '@/hooks/useCurrentOrganization';
import { createShelf, setShelfActive, updateShelf } from '@/lib/api/shelves';

// Shelves are stored in the `warehouses` table (selected as "倉庫" when creating inventory).

export interface Shelf {
  id: string;
  name: string;
  location: string | null;
  isActive: boolean;
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
        .select('id, name, location, is_active, inventory_rolls(current_quantity)')
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
          isActive: warehouse.is_active,
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
      await createShelf(organizationId, { name });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shelves'] });
      queryClient.invalidateQueries({ queryKey: ['warehouses'] });
    },
  });
};

export const useRenameShelf = () => {
  const queryClient = useQueryClient();
  const { organizationId } = useCurrentOrganization();

  return useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      if (!organizationId) throw new Error('請先選擇組織');
      await updateShelf(organizationId, id, { name });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shelves'] });
      queryClient.invalidateQueries({ queryKey: ['warehouses'] });
    },
  });
};

export const useSetShelfActive = () => {
  const queryClient = useQueryClient();
  const { organizationId } = useCurrentOrganization();

  return useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      if (!organizationId) throw new Error('請先選擇組織');
      await setShelfActive(organizationId, id, isActive);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shelves'] });
      queryClient.invalidateQueries({ queryKey: ['warehouses'] });
      queryClient.invalidateQueries({ queryKey: ['warehouse-options'] });
    },
  });
};
