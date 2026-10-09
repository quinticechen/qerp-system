import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import { InventoryRollPayload, newLineItemKey } from '@/lib/documentItemsService';
import { updateInventory } from '@/lib/api/inventory';
import { generateRollNumber } from '@/lib/rollNumber';
import type { Json } from '@/integrations/supabase/types';
import {
  BatchEdits,
  RollEdits,
  RollSnapshot,
  updateInventoryBatch,
  updateInventoryRoll,
} from '@/lib/inventoryService';

export interface NamedOption {
  id: string;
  name: string;
}

// Every query that shows inventory figures must refresh after an edit
const INVENTORY_QUERY_KEYS = [
  ['inventories'],
  ['inventoryRolls'],
  ['product-rolls'],
  ['inventory-summary'],
  ['inventory-summary-enhanced'],
  ['shelves'],
  ['shelf-products'],
  ['purchases'],
  ['record-audit-logs'],
];

export const useFactoryOptions = (organizationId: string | null | undefined) =>
  useQuery({
    queryKey: ['factories', organizationId],
    queryFn: async (): Promise<NamedOption[]> => {
      const { data, error } = await supabase
        .from('factories')
        .select('id, name')
        .eq('organization_id', organizationId!)
        .order('name');
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!organizationId,
  });

export const useWarehouseOptions = (organizationId: string | null | undefined) =>
  useQuery({
    queryKey: ['warehouse-options', organizationId],
    queryFn: async (): Promise<NamedOption[]> => {
      const { data, error } = await supabase
        .from('warehouses')
        .select('id, name, is_active')
        .eq('organization_id', organizationId!)
        .order('name');
      if (error) throw error;
      // Rolls already on a disabled shelf keep showing it; it cannot be picked for other rolls
      return (data ?? []).map((shelf) => ({ id: shelf.id, name: shelf.is_active === false ? `${shelf.name}（已停用）` : shelf.name }));
    },
    enabled: !!organizationId,
  });

const useInvalidateInventory = () => {
  const queryClient = useQueryClient();
  return () => {
    INVENTORY_QUERY_KEYS.forEach((queryKey) => queryClient.invalidateQueries({ queryKey }));
  };
};

export const useUpdateInventoryBatch = () => {
  const invalidate = useInvalidateInventory();
  return useMutation({
    mutationFn: ({ organizationId, inventoryId, edits }: { organizationId: string; inventoryId: string; edits: BatchEdits }) =>
      updateInventoryBatch(organizationId, inventoryId, edits),
    onSuccess: invalidate,
  });
};

export const useUpdateInventoryRoll = () => {
  const invalidate = useInvalidateInventory();
  return useMutation({
    mutationFn: ({ organizationId, roll, edits }: { organizationId: string; roll: RollSnapshot; edits: RollEdits }) =>
      updateInventoryRoll(organizationId, roll, edits),
    onSuccess: invalidate,
  });
};

export interface ProductRoll {
  id: string;
  roll_number: string;
  quantity: number;
  current_quantity: number;
  quality: Database['public']['Enums']['fabric_quality'];
  shelf: string | null;
  is_allocated: boolean;
  warehouse_id: string;
  warehouses: { name: string } | null;
  inventories: { arrival_date: string; purchase_orders: { po_number: string } | null } | null;
}

// Rolls of one product that still hold stock, matching what the inventory summary counts
export const useProductRolls = (productId: string | null) =>
  useQuery({
    queryKey: ['product-rolls', productId],
    queryFn: async (): Promise<ProductRoll[]> => {
      const { data, error } = await supabase
        .from('inventory_rolls')
        .select(`
          id, roll_number, quantity, current_quantity, quality, shelf, is_allocated, warehouse_id,
          warehouses:warehouse_id (name),
          inventories:inventory_id (arrival_date, purchase_orders (po_number))
        `)
        .eq('product_id', productId!)
        .gt('current_quantity', 0)
        .order('roll_number');
      if (error) throw error;
      return (data ?? []) as unknown as ProductRoll[];
    },
    enabled: !!productId,
  });

type FabricQuality = Database['public']['Enums']['fabric_quality'];

// Form state for one roll in the batch rolls editor; weight stays a string while the user types
export interface EditableInventoryRoll {
  key: string;
  id?: string;
  roll_number: string;
  product_id: string;
  warehouse_id: string;
  shelf: string;
  quality: FabricQuality;
  quantity: string;
  // Weight already shipped from this roll; it cannot be removed, switched or weighed below this
  shipped: number;
  specifications: Json | null;
}

export interface InventoryRollRow {
  id: string;
  roll_number: string;
  product_id: string;
  warehouse_id: string;
  shelf: string | null;
  quality: FabricQuality;
  quantity: number;
  current_quantity: number;
  specifications: Json | null;
}

export const toEditableInventoryRoll = (row: InventoryRollRow): EditableInventoryRoll => ({
  key: row.id,
  id: row.id,
  roll_number: row.roll_number,
  product_id: row.product_id,
  warehouse_id: row.warehouse_id,
  shelf: row.shelf ?? '',
  quality: row.quality,
  quantity: String(row.quantity),
  shipped: Number(row.quantity) - Number(row.current_quantity),
  specifications: row.specifications,
});

export const newInventoryRoll = (): EditableInventoryRoll => ({
  key: newLineItemKey(),
  roll_number: generateRollNumber(),
  product_id: '',
  warehouse_id: '',
  shelf: '',
  quality: 'A',
  quantity: '',
  shipped: 0,
  specifications: null,
});

export const toInventoryRollsPayload = (rolls: EditableInventoryRoll[]): InventoryRollPayload[] =>
  rolls.map((roll) => ({
    ...(roll.id ? { id: roll.id } : { roll_number: roll.roll_number.trim() }),
    product_id: roll.product_id,
    warehouse_id: roll.warehouse_id,
    shelf: roll.shelf.trim() || null,
    quality: roll.quality,
    quantity: Number(roll.quantity),
    specifications: roll.specifications,
  }));

export const useSaveInventoryRolls = () => {
  const invalidate = useInvalidateInventory();
  return useMutation({
    // One call saves the complete roll list; the database checks the lock rules
    mutationFn: ({ organizationId, inventoryId, rolls }: { organizationId: string; inventoryId: string; rolls: EditableInventoryRoll[] }) =>
      updateInventory(organizationId, inventoryId, { rolls: toInventoryRollsPayload(rolls) }),
    onSuccess: invalidate,
  });
};
