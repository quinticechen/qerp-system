
import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

export type InventorySummaryItem = {
  product_id: string;
  product_name: string;
  color: string | null;
  color_code: string | null;
  stock_thresholds: number | null;
  product_status: 'Available' | 'Unavailable';
  total_stock: number;
  total_rolls: number;
  a_grade_stock: number;
  b_grade_stock: number;
  c_grade_stock: number;
  d_grade_stock: number;
  defective_stock: number;
  a_grade_rolls: number;
  b_grade_rolls: number;
  c_grade_rolls: number;
  d_grade_rolls: number;
  defective_rolls: number;
  a_grade_details: string[] | null;
  b_grade_details: string[] | null;
  c_grade_details: string[] | null;
  d_grade_details: string[] | null;
  defective_details: string[] | null;
  pending_in_quantity: number;
  pending_out_quantity: number;
};

export const useInventorySummary = () => {
  const [inventoryData, setInventoryData] = useState<InventorySummaryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);

  const ITEMS_PER_PAGE = 100;

  const loadInventorySummary = async (page = 0, isAppend = false) => {
    try {
      setLoading(true);
      
      // Get current user's organization
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        console.log('No user found');
        setInventoryData([]);
        setLoading(false);
        return;
      }

      // Get user's organization
      const { data: userOrgs } = await supabase
        .from('user_organizations')
        .select('organization_id')
        .eq('user_id', user.id)
        .eq('is_active', true)
        .limit(1);

      if (!userOrgs || userOrgs.length === 0) {
        console.log('No organization found for user');
        setInventoryData([]);
        setLoading(false);
        return;
      }

      const organizationId = userOrgs[0].organization_id;
      console.log('Loading inventory for organization:', organizationId);

      // Get products for this organization first
      let productQuery = supabase
        .from('products_new')
        .select('id')
        .eq('organization_id', organizationId);

      if (searchTerm) {
        productQuery = productQuery.or(`name.ilike.%${searchTerm}%,color.ilike.%${searchTerm}%`);
      }

      const { data: orgProducts, error: productError } = await productQuery;
      
      if (productError) {
        console.error('Error fetching organization products:', productError);
        throw productError;
      }

      if (!orgProducts || orgProducts.length === 0) {
        console.log('No products found for organization');
        setInventoryData([]);
        setLoading(false);
        return;
      }

      const productIds = orgProducts.map(p => p.id);
      console.log('Found products for organization:', productIds.length);

      // Now get inventory summary for these products
      let query = supabase
        .from('inventory_summary_enhanced')
        .select('*')
        .in('product_id', productIds)
        .range(page * ITEMS_PER_PAGE, (page + 1) * ITEMS_PER_PAGE - 1)
        .order('product_name');

      const { data, error } = await query;

      if (error) {
        console.error('Error fetching inventory summary:', error);
        throw error;
      }

      console.log('Inventory summary data:', data?.length || 0, 'items');

      const newData = (data || []).map(item => ({
        product_id: item.product_id || '',
        product_name: item.product_name || '未知產品',
        color: item.color,
        color_code: item.color_code,
        stock_thresholds: item.stock_thresholds,
        product_status: item.product_status || 'Available',
        total_stock: Number(item.total_stock || 0),
        total_rolls: Number(item.total_rolls || 0),
        a_grade_stock: Number(item.a_grade_stock || 0),
        b_grade_stock: Number(item.b_grade_stock || 0),
        c_grade_stock: Number(item.c_grade_stock || 0),
        d_grade_stock: Number(item.d_grade_stock || 0),
        defective_stock: Number(item.defective_stock || 0),
        a_grade_rolls: Number(item.a_grade_rolls || 0),
        b_grade_rolls: Number(item.b_grade_rolls || 0),
        c_grade_rolls: Number(item.c_grade_rolls || 0),
        d_grade_rolls: Number(item.d_grade_rolls || 0),
        defective_rolls: Number(item.defective_rolls || 0),
        a_grade_details: item.a_grade_details,
        b_grade_details: item.b_grade_details,
        c_grade_details: item.c_grade_details,
        d_grade_details: item.d_grade_details,
        defective_details: item.defective_details,
        pending_in_quantity: Number(item.pending_in_quantity || 0),
        pending_out_quantity: Number(item.pending_out_quantity || 0),
      }));

      setHasMore(newData.length === ITEMS_PER_PAGE);

      if (isAppend) {
        setInventoryData(prev => [...prev, ...newData]);
      } else {
        setInventoryData(newData);
      }
    } catch (error) {
      console.error('Failed to load inventory summary:', error);
      setInventoryData([]);
    } finally {
      setLoading(false);
    }
  };

  const loadMore = () => {
    if (!loading && hasMore) {
      const nextPage = currentPage + 1;
      setCurrentPage(nextPage);
      loadInventorySummary(nextPage, true);
    }
  };

  const search = (term: string) => {
    setSearchTerm(term);
    setCurrentPage(0);
    loadInventorySummary(0, false);
  };

  useEffect(() => {
    loadInventorySummary();
  }, []);

  return {
    inventoryData,
    loading,
    hasMore,
    searchTerm,
    loadMore,
    search,
    reload: () => loadInventorySummary(0, false),
  };
};
