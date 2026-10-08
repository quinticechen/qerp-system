import type { Json } from '@/integrations/supabase/types';
import { callApi } from './client';

// Products and their colors (docs/BUSINESS_API.md §7, A6). A product holds the name, category and unit;
// each color is what orders, purchases and stock refer to.

export const PRODUCT_CATEGORIES = ['布料', '胚布', '紗線', '輔料'];

export interface NewProductColor {
  color: string;
  color_code?: string;
  color_hex?: string;
  stock_threshold?: number | null;
}

export interface ProductChanges {
  name?: string;
  category?: string;
  unit_of_measure?: string;
}

// An empty string or null clears a field
export interface ProductColorChanges {
  color?: string;
  color_code?: string;
  color_hex?: string;
  stock_threshold?: number | null;
}

export const createProduct = (
  organizationId: string,
  product: { name: string; category?: string; unitOfMeasure?: string; colors: NewProductColor[] },
  dryRun = false,
) =>
  callApi('create_product', {
    p_organization_id: organizationId,
    p_name: product.name,
    p_colors: product.colors as unknown as Json,
    p_category: product.category,
    p_unit_of_measure: product.unitOfMeasure,
    p_dry_run: dryRun,
  });

export const updateProduct = (organizationId: string, productId: string, changes: ProductChanges, dryRun = false) =>
  callApi('update_product', {
    p_organization_id: organizationId,
    p_product_id: productId,
    p_changes: changes as unknown as Json,
    p_dry_run: dryRun,
  });

export const setProductActive = (organizationId: string, productId: string, isActive: boolean, dryRun = false) =>
  callApi('set_product_active', {
    p_organization_id: organizationId,
    p_product_id: productId,
    p_is_active: isActive,
    p_dry_run: dryRun,
  });

export const addProductColor = (organizationId: string, productId: string, color: NewProductColor, dryRun = false) =>
  callApi('add_product_color', {
    p_organization_id: organizationId,
    p_product_id: productId,
    p_color: color.color,
    p_color_code: color.color_code,
    p_color_hex: color.color_hex,
    p_stock_threshold: color.stock_threshold ?? undefined,
    p_dry_run: dryRun,
  });

export const updateProductColor = (organizationId: string, colorId: string, changes: ProductColorChanges, dryRun = false) =>
  callApi('update_product_color', {
    p_organization_id: organizationId,
    p_color_id: colorId,
    p_changes: changes as unknown as Json,
    p_dry_run: dryRun,
  });

export const setProductColorActive = (organizationId: string, colorId: string, isActive: boolean, dryRun = false) =>
  callApi('set_product_color_active', {
    p_organization_id: organizationId,
    p_color_id: colorId,
    p_is_active: isActive,
    p_dry_run: dryRun,
  });
