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
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Plus, Edit, Trash2, Search, Package, Clock, User, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

// 顏色項目類型
type ColorVariant = {
  color: string;
  color_code: string;
};

// 產品表單驗證模式 - 支援多個顏色變體
const productSchema = z.object({
  name: z.string().min(1, '產品名稱為必填'),
  category: z.string().default('布料'),
  colorVariants: z.array(z.object({
    color: z.string().optional(),
    color_code: z.string().optional().transform(val => val ? val.toUpperCase() : val), // 自動轉大寫
  })).min(1, '至少需要一個顏色變體'),
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
  updated_by: string | null;
};

type UserProfile = {
  id: string;
  email: string;
  full_name: string | null;
};

const ProductManagement = () => {
  const [products, setProducts] = useState<Product[]>([]);
  const [userProfiles, setUserProfiles] = useState<{ [key: string]: UserProfile }>({});
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();
  const { user } = useAuth();

  const form = useForm<ProductFormData>({
    resolver: zodResolver(productSchema),
    defaultValues: {
      name: '',
      category: '布料',
      colorVariants: [{ color: '', color_code: '' }],
    },
  });

  // 載入用戶資料
  const loadUserProfiles = async (userIds: string[]) => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, email, full_name')
        .in('id', userIds);

      if (error) throw error;

      const profilesMap: { [key: string]: UserProfile } = {};
      data?.forEach(profile => {
        profilesMap[profile.id] = profile;
      });
      
      setUserProfiles(prev => ({ ...prev, ...profilesMap }));
    } catch (error: any) {
      console.error('Failed to load user profiles:', error);
    }
  };

  // 載入產品列表
  const loadProducts = async () => {
    try {
      console.log('Loading products...');
      const { data, error } = await supabase
        .from('products_new')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error loading products:', error);
        throw error;
      }
      
      console.log('Products loaded:', data);
      setProducts(data || []);

      // 收集所有相關的用戶 ID
      const userIds = new Set<string>();
      data?.forEach(product => {
        if (product.user_id) userIds.add(product.user_id);
        if (product.updated_by) userIds.add(product.updated_by);
      });

      if (userIds.size > 0) {
        await loadUserProfiles(Array.from(userIds));
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

  useEffect(() => {
    loadProducts();
  }, []);

  // 新增顏色變體
  const addColorVariant = () => {
    const currentVariants = form.getValues('colorVariants');
    form.setValue('colorVariants', [...currentVariants, { color: '', color_code: '' }]);
  };

  // 移除顏色變體
  const removeColorVariant = (index: number) => {
    const currentVariants = form.getValues('colorVariants');
    if (currentVariants.length > 1) {
      form.setValue('colorVariants', currentVariants.filter((_, i) => i !== index));
    }
  };

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

    setSubmitting(true);
    
    try {
      console.log('Submitting product data:', data);
      console.log('Current user:', user);

      // 確保必填欄位存在
      if (!data.name || data.name.trim() === '') {
        throw new Error('產品名稱為必填欄位');
      }

      // 確保用戶在 profiles 表中存在
      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('id')
        .eq('id', user.id)
        .single();

      if (profileError || !profileData) {
        console.log('User profile not found, creating...');
        // 創建用戶資料
        const { error: createProfileError } = await supabase
          .from('profiles')
          .insert([{
            id: user.id,
            email: user.email || '',
            full_name: user.user_metadata?.full_name || null,
          }]);

        if (createProfileError) {
          console.error('Failed to create profile:', createProfileError);
          throw new Error('無法創建用戶資料，請聯絡系統管理員');
        }
      }

      if (editingProduct) {
        // 更新產品 - 只更新第一個顏色變體
        const firstVariant = data.colorVariants[0];
        const productData = {
          name: data.name.trim(),
          category: data.category || '布料',
          color: firstVariant.color && firstVariant.color.trim() !== '' ? firstVariant.color.trim() : null,
          color_code: firstVariant.color_code && firstVariant.color_code.trim() !== '' ? firstVariant.color_code.trim().toUpperCase() : null,
          unit_of_measure: 'KG',
          user_id: user.id,
        };

        console.log('Updating product with ID:', editingProduct.id);
        const { error } = await supabase
          .from('products_new')
          .update(productData)
          .eq('id', editingProduct.id);

        if (error) {
          console.error('Update error:', error);
          throw error;
        }

        toast({
          title: "更新成功",
          description: `產品「${data.name}」已更新`,
        });
      } else {
        // 新增產品 - 為每個顏色變體創建一個產品記錄
        const productsToInsert = data.colorVariants
          .filter(variant => variant.color || variant.color_code) // 只有顏色或顏色代碼不為空的才創建
          .map(variant => ({
            name: data.name.trim(),
            category: data.category || '布料',
            color: variant.color && variant.color.trim() !== '' ? variant.color.trim() : null,
            color_code: variant.color_code && variant.color_code.trim() !== '' ? variant.color_code.trim().toUpperCase() : null,
            unit_of_measure: 'KG',
            user_id: user.id,
          }));

        // 如果沒有任何顏色變體，創建一個基本產品
        if (productsToInsert.length === 0) {
          productsToInsert.push({
            name: data.name.trim(),
            category: data.category || '布料',
            color: null,
            color_code: null,
            unit_of_measure: 'KG',
            user_id: user.id,
          });
        }

        console.log('Inserting products:', productsToInsert);
        const { data: insertedData, error } = await supabase
          .from('products_new')
          .insert(productsToInsert)
          .select();

        if (error) {
          console.error('Insert error:', error);
          throw error;
        }

        console.log('Products inserted successfully:', insertedData);

        toast({
          title: "新增成功",
          description: `產品「${data.name}」已新增 ${productsToInsert.length} 個變體`,
        });
      }

      form.reset();
      setEditingProduct(null);
      setIsDialogOpen(false);
      await loadProducts();
    } catch (error: any) {
      console.error('Submit error:', error);
      toast({
        title: editingProduct ? "更新失敗" : "新增失敗",
        description: error.message || '操作失敗，請稍後再試',
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  // 刪除產品 - 新增確認對話框
  const handleDelete = async (product: Product) => {
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

  // 取得用戶顯示名稱
  const getUserDisplayName = (userId: string | null) => {
    if (!userId) return '-';
    const profile = userProfiles[userId];
    return profile?.full_name || profile?.email || '未知用戶';
  };

  // 編輯產品
  const handleEdit = (product: Product) => {
    setEditingProduct(product);
    form.reset({
      name: product.name,
      category: product.category,
      colorVariants: [{
        color: product.color || '',
        color_code: product.color_code || '',
      }],
    });
    setIsDialogOpen(true);
  };

  // 開啟新增對話框
  const handleAddNew = () => {
    setEditingProduct(null);
    form.reset({
      name: '',
      category: '布料',
      colorVariants: [{ color: '', color_code: '' }],
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
        <h2 className="text-2xl font-bold text-slate-900">產品管理</h2>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button 
              className="bg-blue-600 hover:bg-blue-700 text-white"
              onClick={handleAddNew}
            >
              <Plus size={16} className="mr-2" />
              新增產品
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[600px] bg-white border border-gray-200 max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="text-gray-900">
                {editingProduct ? '編輯產品' : '新增產品'}
              </DialogTitle>
              <DialogDescription className="text-gray-700">
                {editingProduct ? '修改產品資訊' : '建立新的布料產品型號，可一次新增多個顏色變體'}
              </DialogDescription>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-gray-900 font-medium">產品名稱 *</FormLabel>
                      <FormControl>
                        <Input 
                          placeholder="請輸入產品名稱" 
                          className="bg-white border-gray-300 text-gray-900 focus:border-blue-500 focus:ring-blue-500"
                          {...field} 
                        />
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
                      <FormLabel className="text-gray-900 font-medium">類別</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger className="bg-white border-gray-300 text-gray-900 focus:border-blue-500 focus:ring-blue-500">
                            <SelectValue placeholder="選擇產品類別" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent className="bg-white border-gray-200 shadow-lg">
                          <SelectItem value="布料" className="text-gray-900 hover:bg-gray-100 hover:text-gray-900 focus:bg-gray-100 focus:text-gray-900">布料</SelectItem>
                          <SelectItem value="紗線" className="text-gray-900 hover:bg-gray-100 hover:text-gray-900 focus:bg-gray-100 focus:text-gray-900">紗線</SelectItem>
                          <SelectItem value="輔料" className="text-gray-900 hover:bg-gray-100 hover:text-gray-900 focus:bg-gray-100 focus:text-gray-900">輔料</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* 顏色變體區域 */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-gray-900 font-medium">
                      顏色變體 {!editingProduct && '(可新增多個)'}
                    </Label>
                    {!editingProduct && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={addColorVariant}
                        className="text-blue-600 border-blue-600 hover:bg-blue-50"
                      >
                        <Plus size={14} className="mr-1" />
                        新增變體
                      </Button>
                    )}
                  </div>
                  
                  {form.watch('colorVariants').map((_, index) => (
                    <div key={index} className="border border-gray-200 rounded-lg p-4 bg-gray-50">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-sm font-medium text-gray-700">
                          變體 {index + 1}
                        </span>
                        {!editingProduct && form.watch('colorVariants').length > 1 && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => removeColorVariant(index)}
                            className="text-red-600 hover:bg-red-50 p-1"
                          >
                            <X size={14} />
                          </Button>
                        )}
                      </div>
                      
                      <div className="grid grid-cols-2 gap-3">
                        <FormField
                          control={form.control}
                          name={`colorVariants.${index}.color`}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-gray-900 text-sm">顏色</FormLabel>
                              <FormControl>
                                <Input 
                                  placeholder="如：米白、深藍" 
                                  className="bg-white border-gray-300 text-gray-900 focus:border-blue-500 focus:ring-blue-500"
                                  {...field} 
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        <FormField
                          control={form.control}
                          name={`colorVariants.${index}.color_code`}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-gray-900 text-sm">顏色代碼</FormLabel>
                              <FormControl>
                                <Input 
                                  placeholder="如：#FFFFFF" 
                                  className="bg-white border-gray-300 text-gray-900 focus:border-blue-500 focus:ring-blue-500"
                                  {...field}
                                  onChange={(e) => {
                                    // 在輸入時即時轉換為大寫
                                    const value = e.target.value.toUpperCase();
                                    field.onChange(value);
                                  }}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                    </div>
                  ))}
                </div>

                <div className="bg-blue-50 p-3 rounded border border-blue-200">
                  <Label className="text-sm text-blue-900 font-medium">計量單位：公斤 (KG)</Label>
                  <p className="text-xs text-blue-700 mt-1">布料產品統一使用公斤作為計量單位</p>
                </div>

                <div className="flex justify-end space-x-2 pt-4">
                  <Button 
                    type="button" 
                    variant="outline" 
                    onClick={() => setIsDialogOpen(false)}
                    disabled={submitting}
                    className="border-gray-300 text-gray-900 hover:bg-gray-50 hover:text-gray-900"
                  >
                    取消
                  </Button>
                  <Button 
                    type="submit" 
                    disabled={submitting}
                    className="bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
                  >
                    {submitting ? '處理中...' : (editingProduct ? '更新' : '新增')}
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
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-500" size={16} />
            <Input
              placeholder="搜尋產品名稱、顏色或顏色代碼..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 text-gray-900 placeholder:text-gray-500"
            />
          </div>
        </CardContent>
      </Card>

      {/* 產品列表 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center text-slate-900">
            <Package className="mr-2" size={20} />
            產品列表
          </CardTitle>
          <CardDescription className="text-gray-700">
            管理布料產品型號，共 {filteredProducts.length} 項產品
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-8">
              <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
              <p className="text-slate-700">載入中...</p>
            </div>
          ) : filteredProducts.length === 0 ? (
            <div className="text-center py-8">
              <Package size={48} className="mx-auto text-slate-500 mb-4" />
              <h3 className="text-lg font-semibold text-slate-800 mb-2">
                {searchTerm ? '沒有找到符合的產品' : '尚未新增產品'}
              </h3>
              <p className="text-slate-600">
                {searchTerm ? '請嘗試調整搜尋條件' : '點擊「新增產品」開始建立產品型號'}
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-gray-900 font-semibold">產品名稱</TableHead>
                  <TableHead className="text-gray-900 font-semibold">類別</TableHead>
                  <TableHead className="text-gray-900 font-semibold">顏色</TableHead>
                  <TableHead className="text-gray-900 font-semibold">顏色代碼</TableHead>
                  <TableHead className="text-gray-900 font-semibold">計量單位</TableHead>
                  <TableHead className="text-gray-900 font-semibold">建立時間</TableHead>
                  <TableHead className="text-gray-900 font-semibold">最後修改</TableHead>
                  <TableHead className="text-right text-gray-900 font-semibold">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredProducts.map((product) => (
                  <TableRow key={product.id}>
                    <TableCell className="font-medium text-gray-900">{product.name}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="bg-blue-100 text-blue-800 border-blue-200">{product.category}</Badge>
                    </TableCell>
                    <TableCell className="text-gray-900">{product.color || '無'}</TableCell>
                    <TableCell>
                      {product.color_code ? (
                        <div className="flex items-center space-x-2">
                          <div 
                            className="w-4 h-4 rounded border border-slate-400"
                            style={{ backgroundColor: product.color_code }}
                          ></div>
                          <span className="text-sm text-gray-900">{product.color_code}</span>
                        </div>
                      ) : <span className="text-gray-900">無</span>}
                    </TableCell>
                    <TableCell className="text-gray-900">{product.unit_of_measure}</TableCell>
                    <TableCell className="text-gray-900">{new Date(product.created_at).toLocaleDateString('zh-TW')}</TableCell>
                    <TableCell>
                      <div className="flex flex-col text-sm">
                        <div className="flex items-center text-gray-700">
                          <Clock size={12} className="mr-1" />
                          {new Date(product.updated_at).toLocaleDateString('zh-TW')}
                        </div>
                        {product.updated_by && (
                          <div className="flex items-center text-gray-600 mt-1">
                            <User size={12} className="mr-1" />
                            {getUserDisplayName(product.updated_by)}
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end space-x-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleEdit(product)}
                          className="border-gray-300 text-gray-900 hover:bg-gray-50"
                        >
                          <Edit size={14} className="mr-1" />
                          編輯
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              size="sm"
                              variant="destructive"
                              className="bg-red-600 hover:bg-red-700 text-white"
                            >
                              <Trash2 size={14} className="mr-1" />
                              刪除
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent className="bg-white">
                            <AlertDialogHeader>
                              <AlertDialogTitle className="text-gray-900">確認刪除產品</AlertDialogTitle>
                              <AlertDialogDescription className="text-gray-700">
                                您確定要刪除產品「{product.name}」嗎？
                                <br />
                                <span className="text-red-600 font-semibold">此操作無法復原！</span>
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel className="text-gray-900 border-gray-300 hover:bg-gray-50">取消</AlertDialogCancel>
                              <AlertDialogAction 
                                onClick={() => handleDelete(product)}
                                className="bg-red-600 hover:bg-red-700 text-white"
                              >
                                確認刪除
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
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
