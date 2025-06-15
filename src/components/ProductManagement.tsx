
import React, { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Plus, Edit, Trash2, Search, Package } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

// 產品表單驗證模式
const productSchema = z.object({
  name: z.string().min(1, '產品名稱為必填'),
  category: z.string().default('布料'),
  color: z.string().optional(),
  color_code: z.string().optional(),
  unit_of_measure: z.string().default('KG'),
});

type ProductFormData = z.infer<typeof productSchema>;
type Product = {
  id: string;
  name: string;
  category: string;
  color: string | null;
  color_code: string | null;
  unit_of_measure: string;
  created_at: string;
  updated_at: string;
  user_id: string;
};

const ProductManagement = () => {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const { toast } = useToast();
  const { user } = useAuth();

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
      const { data, error } = await supabase
        .from('products_new')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setProducts(data || []);
    } catch (error: any) {
      toast({
        title: "載入失敗",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProducts();
  }, []);

  // 新增或更新產品
  const onSubmit = async (data: ProductFormData) => {
    if (!user) {
      toast({
        title: "錯誤",
        description: "請先登入",
        variant: "destructive",
      });
      return;
    }

    try {
      const productData = {
        name: data.name,
        category: data.category || '布料',
        color: data.color || null,
        color_code: data.color_code || null,
        unit_of_measure: data.unit_of_measure || 'KG',
        user_id: user.id,
      };

      if (editingProduct) {
        // 更新產品
        const { error } = await supabase
          .from('products_new')
          .update(productData)
          .eq('id', editingProduct.id);

        if (error) throw error;

        toast({
          title: "更新成功",
          description: `產品「${data.name}」已更新`,
        });
      } else {
        // 新增產品
        const { error } = await supabase
          .from('products_new')
          .insert([productData]);

        if (error) throw error;

        toast({
          title: "新增成功",
          description: `產品「${data.name}」已新增`,
        });
      }

      form.reset();
      setEditingProduct(null);
      setIsDialogOpen(false);
      loadProducts();
    } catch (error: any) {
      toast({
        title: editingProduct ? "更新失敗" : "新增失敗",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  // 刪除產品
  const handleDelete = async (product: Product) => {
    if (!confirm(`確定要刪除產品「${product.name}」嗎？`)) return;

    try {
      const { error } = await supabase
        .from('products_new')
        .delete()
        .eq('id', product.id);

      if (error) throw error;

      toast({
        title: "刪除成功",
        description: `產品「${product.name}」已刪除`,
      });

      loadProducts();
    } catch (error: any) {
      toast({
        title: "刪除失敗",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  // 編輯產品
  const handleEdit = (product: Product) => {
    setEditingProduct(product);
    form.reset({
      name: product.name,
      category: product.category,
      color: product.color || '',
      color_code: product.color_code || '',
      unit_of_measure: product.unit_of_measure,
    });
    setIsDialogOpen(true);
  };

  // 過濾產品
  const filteredProducts = products.filter(product =>
    product.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (product.color && product.color.toLowerCase().includes(searchTerm.toLowerCase())) ||
    (product.color_code && product.color_code.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-slate-800">產品管理</h2>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button 
              className="bg-blue-600 hover:bg-blue-700"
              onClick={() => {
                setEditingProduct(null);
                form.reset({
                  name: '',
                  category: '布料',
                  color: '',
                  color_code: '',
                  unit_of_measure: 'KG',
                });
              }}
            >
              <Plus size={16} className="mr-2" />
              新增產品
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle>{editingProduct ? '編輯產品' : '新增產品'}</DialogTitle>
              <DialogDescription>
                {editingProduct ? '修改產品資訊' : '建立新的布料產品型號'}
              </DialogDescription>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>產品名稱 *</FormLabel>
                      <FormControl>
                        <Input placeholder="請輸入產品名稱" {...field} />
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
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="選擇產品類別" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="布料">布料</SelectItem>
                          <SelectItem value="紗線">紗線</SelectItem>
                          <SelectItem value="輔料">輔料</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="color"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>顏色</FormLabel>
                        <FormControl>
                          <Input placeholder="如：米白、深藍" {...field} />
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
                          <Input placeholder="如：#FFFFFF" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="unit_of_measure"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>計量單位</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="選擇計量單位" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="KG">公斤 (KG)</SelectItem>
                          <SelectItem value="M">公尺 (M)</SelectItem>
                          <SelectItem value="YD">碼 (YD)</SelectItem>
                          <SelectItem value="PCS">件 (PCS)</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="flex justify-end space-x-2 pt-4">
                  <Button 
                    type="button" 
                    variant="outline" 
                    onClick={() => setIsDialogOpen(false)}
                  >
                    取消
                  </Button>
                  <Button type="submit">
                    {editingProduct ? '更新' : '新增'}
                  </Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      {/* 搜尋列 */}
      <Card>
        <CardContent className="p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400" size={16} />
            <Input
              placeholder="搜尋產品名稱、顏色或顏色代碼..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
        </CardContent>
      </Card>

      {/* 產品列表 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center">
            <Package className="mr-2" size={20} />
            產品列表
          </CardTitle>
          <CardDescription>
            管理布料產品型號，共 {filteredProducts.length} 項產品
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-8">
              <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
              <p className="text-slate-600">載入中...</p>
            </div>
          ) : filteredProducts.length === 0 ? (
            <div className="text-center py-8">
              <Package size={48} className="mx-auto text-slate-400 mb-4" />
              <h3 className="text-lg font-semibold text-slate-600 mb-2">
                {searchTerm ? '沒有找到符合的產品' : '尚未新增產品'}
              </h3>
              <p className="text-slate-500">
                {searchTerm ? '請嘗試調整搜尋條件' : '點擊「新增產品」開始建立產品型號'}
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>產品名稱</TableHead>
                  <TableHead>類別</TableHead>
                  <TableHead>顏色</TableHead>
                  <TableHead>顏色代碼</TableHead>
                  <TableHead>計量單位</TableHead>
                  <TableHead>建立時間</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredProducts.map((product) => (
                  <TableRow key={product.id}>
                    <TableCell className="font-medium">{product.name}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{product.category}</Badge>
                    </TableCell>
                    <TableCell>{product.color || '-'}</TableCell>
                    <TableCell>
                      {product.color_code ? (
                        <div className="flex items-center space-x-2">
                          <div 
                            className="w-4 h-4 rounded border border-slate-300"
                            style={{ backgroundColor: product.color_code }}
                          ></div>
                          <span className="text-sm">{product.color_code}</span>
                        </div>
                      ) : '-'}
                    </TableCell>
                    <TableCell>{product.unit_of_measure}</TableCell>
                    <TableCell>{new Date(product.created_at).toLocaleDateString('zh-TW')}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end space-x-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleEdit(product)}
                        >
                          <Edit size={14} className="mr-1" />
                          編輯
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => handleDelete(product)}
                        >
                          <Trash2 size={14} className="mr-1" />
                          刪除
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default ProductManagement;
