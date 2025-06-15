
import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { useForm } from 'react-hook-form';
import { Plus, Edit, Trash2, Search, Filter } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';

const productSchema = z.object({
  name: z.string().min(1, '產品名稱不能為空'),
  category: z.string().default('布料'),
  color: z.string().optional(),
  color_code: z.string().optional(),
  unit_of_measure: z.string().default('KG'),
});

type ProductFormData = z.infer<typeof productSchema>;

interface Product {
  id: string;
  name: string;
  category: string;
  color: string | null;
  color_code: string | null;
  unit_of_measure: string;
  created_at: string;
  user_id: string;
}

const ProductManagement = () => {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const { toast } = useToast();

  const form = useForm<ProductFormData>({
    resolver: zodResolver(productSchema),
    defaultValues: {
      name: '',
      category: '布料',
      color: '',
      color_code: '',
      unit_of_measure: 'KG',
    },
  });

  // 載入產品列表
  const loadProducts = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('products_new')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setProducts(data || []);
    } catch (error) {
      console.error('載入產品失敗:', error);
      toast({
        title: '錯誤',
        description: '載入產品列表失敗',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  // 新增產品
  const handleAddProduct = async (data: ProductFormData) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('未登入');

      const { error } = await supabase
        .from('products_new')
        .insert([{
          ...data,
          user_id: user.id,
        }]);

      if (error) throw error;

      toast({
        title: '成功',
        description: '產品新增成功',
      });

      setShowAddDialog(false);
      form.reset();
      loadProducts();
    } catch (error) {
      console.error('新增產品失敗:', error);
      toast({
        title: '錯誤',
        description: '新增產品失敗',
        variant: 'destructive',
      });
    }
  };

  // 編輯產品
  const handleEditProduct = async (data: ProductFormData) => {
    if (!editingProduct) return;

    try {
      const { error } = await supabase
        .from('products_new')
        .update(data)
        .eq('id', editingProduct.id);

      if (error) throw error;

      toast({
        title: '成功',
        description: '產品更新成功',
      });

      setEditingProduct(null);
      form.reset();
      loadProducts();
    } catch (error) {
      console.error('更新產品失敗:', error);
      toast({
        title: '錯誤',
        description: '更新產品失敗',
        variant: 'destructive',
      });
    }
  };

  // 刪除產品
  const handleDeleteProduct = async (productId: string) => {
    if (!confirm('確定要刪除此產品嗎？')) return;

    try {
      const { error } = await supabase
        .from('products_new')
        .delete()
        .eq('id', productId);

      if (error) throw error;

      toast({
        title: '成功',
        description: '產品刪除成功',
      });

      loadProducts();
    } catch (error) {
      console.error('刪除產品失敗:', error);
      toast({
        title: '錯誤',
        description: '刪除產品失敗',
        variant: 'destructive',
      });
    }
  };

  // 開始編輯
  const startEditing = (product: Product) => {
    setEditingProduct(product);
    form.reset({
      name: product.name,
      category: product.category,
      color: product.color || '',
      color_code: product.color_code || '',
      unit_of_measure: product.unit_of_measure,
    });
  };

  // 篩選產品
  const filteredProducts = products.filter(product =>
    product.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (product.color && product.color.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  useEffect(() => {
    loadProducts();
  }, []);

  const ProductForm = ({ onSubmit, isEditing = false }: { onSubmit: (data: ProductFormData) => void; isEditing?: boolean }) => (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>產品名稱 *</FormLabel>
                <FormControl>
                  <Input placeholder="輸入產品名稱" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          
          <FormField
            control={form.control}
            name="category"
            render={({ field }) => (
              <FormItem>
                <FormLabel>類別</FormLabel>
                <FormControl>
                  <Input placeholder="布料" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          
          <FormField
            control={form.control}
            name="color"
            render={({ field }) => (
              <FormItem>
                <FormLabel>顏色</FormLabel>
                <FormControl>
                  <Input placeholder="輸入顏色" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          
          <FormField
            control={form.control}
            name="color_code"
            render={({ field }) => (
              <FormItem>
                <FormLabel>顏色代碼</FormLabel>
                <FormControl>
                  <Input placeholder="#FFFFFF" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          
          <FormField
            control={form.control}
            name="unit_of_measure"
            render={({ field }) => (
              <FormItem>
                <FormLabel>計量單位</FormLabel>
                <FormControl>
                  <Input placeholder="KG" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        
        <div className="flex justify-end space-x-3">
          <Button 
            type="button" 
            variant="outline" 
            onClick={() => {
              if (isEditing) {
                setEditingProduct(null);
              } else {
                setShowAddDialog(false);
              }
              form.reset();
            }}
          >
            取消
          </Button>
          <Button type="submit">
            {isEditing ? '更新產品' : '新增產品'}
          </Button>
        </div>
      </form>
    </Form>
  );

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-slate-800">產品管理</h2>
        <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
          <DialogTrigger asChild>
            <Button className="bg-blue-600 hover:bg-blue-700">
              <Plus size={16} className="mr-2" />
              新增產品
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[600px]">
            <DialogHeader>
              <DialogTitle>新增產品</DialogTitle>
              <DialogDescription>
                請填入新產品的詳細資訊
              </DialogDescription>
            </DialogHeader>
            <ProductForm onSubmit={handleAddProduct} />
          </DialogContent>
        </Dialog>
      </div>

      {/* 搜尋和篩選 */}
      <Card>
        <CardContent className="p-4">
          <div className="flex space-x-4">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400" size={16} />
                <Input
                  placeholder="搜尋產品名稱或顏色..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
            <Button variant="outline">
              <Filter size={16} className="mr-2" />
              篩選
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 產品列表 */}
      {loading ? (
        <Card>
          <CardContent className="p-6">
            <div className="text-center">載入中...</div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredProducts.map((product) => (
            <Card key={product.id} className="hover:shadow-lg transition-shadow">
              <CardHeader className="pb-3">
                <div className="flex justify-between items-start">
                  <div>
                    <CardTitle className="text-lg">{product.name}</CardTitle>
                    <CardDescription>{product.category}</CardDescription>
                  </div>
                  <div className="flex space-x-2">
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => startEditing(product)}
                    >
                      <Edit size={14} />
                    </Button>
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="text-red-600 hover:text-red-700"
                      onClick={() => handleDeleteProduct(product.id)}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {product.color && (
                  <div className="flex items-center space-x-3">
                    <div
                      className="w-6 h-6 rounded-full border border-slate-300"
                      style={{ backgroundColor: product.color_code || '#ccc' }}
                    ></div>
                    <span className="text-sm text-slate-600">{product.color}</span>
                    {product.color_code && (
                      <Badge variant="secondary">{product.color_code}</Badge>
                    )}
                  </div>
                )}
                <div className="flex justify-between text-sm">
                  <span className="text-slate-600">計量單位:</span>
                  <Badge>{product.unit_of_measure}</Badge>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-600">建立日期:</span>
                  <span className="text-slate-800">
                    {new Date(product.created_at).toLocaleDateString('zh-TW')}
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* 編輯對話框 */}
      <Dialog open={!!editingProduct} onOpenChange={(open) => !open && setEditingProduct(null)}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>編輯產品</DialogTitle>
            <DialogDescription>
              修改產品的詳細資訊
            </DialogDescription>
          </DialogHeader>
          <ProductForm onSubmit={handleEditProduct} isEditing />
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ProductManagement;
