import type { Json } from '@/integrations/supabase/types';
import { callApi } from './client';

// Shelves, stored in the warehouses table (docs/API.md §3, A6)

export const createShelf = (organizationId: string, shelf: { name: string; location?: string }, dryRun = false) =>
  callApi('create_shelf', {
    p_organization_id: organizationId,
    p_name: shelf.name,
    p_location: shelf.location,
    p_dry_run: dryRun,
  });

// An empty string clears the location
export interface ShelfChanges {
  name?: string;
  location?: string;
}

export const updateShelf = (organizationId: string, shelfId: string, changes: ShelfChanges, dryRun = false) =>
  callApi('update_shelf', {
    p_organization_id: organizationId,
    p_shelf_id: shelfId,
    p_changes: changes as unknown as Json,
    p_dry_run: dryRun,
  });

// A disabled shelf keeps its rolls but cannot receive new ones
export const setShelfActive = (organizationId: string, shelfId: string, isActive: boolean, dryRun = false) =>
  callApi('set_shelf_active', {
    p_organization_id: organizationId,
    p_shelf_id: shelfId,
    p_is_active: isActive,
    p_dry_run: dryRun,
  });
