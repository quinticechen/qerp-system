import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useCurrentOrganization } from '@/hooks/useCurrentOrganization';

// The organization's products, each with its colors and their stock (view product_catalog)

export interface CatalogColor {
  id: string;
  productId: string;
  color: string | null;
  colorCode: string | null;
  colorHex: string | null;
  stockThreshold: number | null;
  isActive: boolean;
  stockQuantity: number;
  stockRolls: number;
  isLowStock: boolean;
  createdBy: string | null;
  createdAt: string;
}

export interface CatalogProduct {
  id: string;
  name: string;
  category: string;
  unitOfMeasure: string;
  isActive: boolean;
  createdBy: string | null;
  createdAt: string;
  colors: CatalogColor[];
  stockQuantity: number;
  lowStockCount: number;
}

export const PRODUCT_CATALOG_QUERY_KEY = 'product-catalog';

export const useProductCatalog = () => {
  const { organizationId, hasOrganization } = useCurrentOrganization();

  return useQuery({
    queryKey: [PRODUCT_CATALOG_QUERY_KEY, organizationId],
    queryFn: async (): Promise<CatalogProduct[]> => {
      const { data, error } = await supabase
        .from('product_catalog')
        .select('*')
        .eq('organization_id', organizationId!)
        .order('product_name')
        .order('color_created_at');
      if (error) throw error;

      const products = new Map<string, CatalogProduct>();
      (data ?? []).forEach((row) => {
        if (!row.product_id || !row.color_id) return;
        let product = products.get(row.product_id);
        if (!product) {
          product = {
            id: row.product_id,
            name: row.product_name ?? '',
            category: row.category ?? '',
            unitOfMeasure: row.unit_of_measure ?? 'KG',
            isActive: row.product_is_active ?? true,
            createdBy: row.product_created_by,
            createdAt: row.product_created_at ?? '',
            colors: [],
            stockQuantity: 0,
            lowStockCount: 0,
          };
          products.set(row.product_id, product);
        }
        const color: CatalogColor = {
          id: row.color_id,
          productId: row.product_id,
          color: row.color,
          colorCode: row.color_code,
          colorHex: row.color_hex,
          stockThreshold: row.stock_threshold,
          isActive: row.color_is_active ?? true,
          stockQuantity: Number(row.stock_quantity ?? 0),
          stockRolls: row.stock_rolls ?? 0,
          isLowStock: row.is_low_stock ?? false,
          createdBy: row.color_created_by,
          createdAt: row.color_created_at ?? '',
        };
        product.colors.push(color);
        product.stockQuantity += color.stockQuantity;
        if (color.isLowStock && color.isActive) product.lowStockCount += 1;
      });
      return [...products.values()];
    },
    enabled: hasOrganization,
  });
};
