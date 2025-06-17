import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';

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
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [currentPage, setCurrentPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const { toast } = useToast();
  const { user } = useAuth();

  const ITEMS_PER_PAGE = 100;

  const loadProducts = async (page = 0, isAppend = false) => {
    try {
      setLoading(true);
      
      let query = supabase
        .from('products_new')
        .select('*')
        .range(page * ITEMS_PER_PAGE, (page + 1) * ITEMS_PER_PAGE - 1)
        .order('created_at', { ascending: false });

      // 應用搜尋過濾
      if (searchTerm) {
        query = query.or(`name.ilike.%${searchTerm}%,category.ilike.%${searchTerm}%,color.ilike.%${searchTerm}%`);
      }

      // 應用類別過濾
      if (categoryFilter && categoryFilter !== 'all') {
        query = query.eq('category', categoryFilter);
      }

      // 應用狀態過濾
      if (statusFilter && statusFilter !== 'all') {
        query = query.eq('status', statusFilter as 'Available' | 'Unavailable');
      }

      const { data, error } = await query;

      if (error) throw error;

      const newProducts = data || [];
      setHasMore(newProducts.length === ITEMS_PER_PAGE);

      if (isAppend) {
        setProducts(prev => [...prev, ...newProducts]);
      } else {
        setProducts(newProducts);
      }
    } catch (error: any) {
      console.error('Failed to load products:', error);
      toast({
        title: "載入失敗",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const createProduct = async (productData: ProductFormData) => {
    if (!user) {
      toast({
        title: "錯誤",
        description: "請先登入",
        variant: "destructive",
      });
      return false;
    }

    try {
      const { error } = await supabase
        .from('products_new')
        .insert({
          ...productData,
          user_id: user.id,
        });

      if (error) throw error;

      toast({
        title: "新增成功",
        description: "產品已成功新增",
      });

      await loadProducts();
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

      await loadProducts();
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

  const loadMore = () => {
    if (!loading && hasMore) {
      const nextPage = currentPage + 1;
      setCurrentPage(nextPage);
      loadProducts(nextPage, true);
    }
  };

  const search = (term: string) => {
    setSearchTerm(term);
    setCurrentPage(0);
    loadProducts(0, false);
  };

  const filterByCategory = (category: string) => {
    setCategoryFilter(category);
    setCurrentPage(0);
    loadProducts(0, false);
  };

  const filterByStatus = (status: string) => {
    setStatusFilter(status);
    setCurrentPage(0);
    loadProducts(0, false);
  };

  useEffect(() => {
    loadProducts();
  }, []);

  return {
    products,
    loading,
    hasMore,
    searchTerm,
    categoryFilter,
    statusFilter,
    createProduct,
    updateProduct,
    loadMore,
    search,
    filterByCategory,
    filterByStatus,
    reload: () => loadProducts(0, false),
  };
};
