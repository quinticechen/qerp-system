
import React, { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { Plus, Edit, Trash2, Search, Factory, Mail, Phone, MapPin } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

const factorySchema = z.object({
  name: z.string().min(1, '工廠名稱為必填'),
  contact_person: z.string().optional(),
  email: z.string().email('請輸入有效的電子郵件').optional().or(z.literal('')),
  phone: z.string().optional(),
  address: z.string().optional(),
});

type FactoryFormData = z.infer<typeof factorySchema>;
type Factory = {
  id: string;
  name: string;
  contact_person: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  created_at: string;
  updated_at: string;
};

const FactoryManagement = () => {
  const [factories, setFactories] = useState<Factory[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingFactory, setEditingFactory] = useState<Factory | null>(null);
  const { toast } = useToast();

  const form = useForm<FactoryFormData>({
    resolver: zodResolver(factorySchema),
    defaultValues: {
      name: '',
      contact_person: '',
      email: '',
      phone: '',
      address: '',
    },
  });

  const loadFactories = async () => {
    try {
      const { data, error } = await supabase
        .from('factories')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setFactories(data || []);
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
    loadFactories();
  }, []);

  const onSubmit = async (data: FactoryFormData) => {
    try {
      const factoryData = {
        name: data.name,
        contact_person: data.contact_person || null,
        email: data.email || null,
        phone: data.phone || null,
        address: data.address || null,
      };

      if (editingFactory) {
        const { error } = await supabase
          .from('factories')
          .update(factoryData)
          .eq('id', editingFactory.id);

        if (error) throw error;

        toast({
          title: "更新成功",
          description: `工廠「${data.name}」已更新`,
        });
      } else {
        const { error } = await supabase
          .from('factories')
          .insert([factoryData]);

        if (error) throw error;

        toast({
          title: "新增成功",
          description: `工廠「${data.name}」已新增`,
        });
      }

      form.reset();
      setEditingFactory(null);
      setIsDialogOpen(false);
      loadFactories();
    } catch (error: any) {
      toast({
        title: editingFactory ? "更新失敗" : "新增失敗",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const handleDelete = async (factory: Factory) => {
    if (!confirm(`確定要刪除工廠「${factory.name}」嗎？`)) return;

    try {
      const { error } = await supabase
        .from('factories')
        .delete()
        .eq('id', factory.id);

      if (error) throw error;

      toast({
        title: "刪除成功",
        description: `工廠「${factory.name}」已刪除`,
      });

      loadFactories();
    } catch (error: any) {
      toast({
        title: "刪除失敗",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const handleEdit = (factory: Factory) => {
    setEditingFactory(factory);
    form.reset({
      name: factory.name,
      contact_person: factory.contact_person || '',
      email: factory.email || '',
      phone: factory.phone || '',
      address: factory.address || '',
    });
    setIsDialogOpen(true);
  };

  const filteredFactories = factories.filter(factory =>
    factory.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (factory.contact_person && factory.contact_person.toLowerCase().includes(searchTerm.toLowerCase())) ||
    (factory.email && factory.email.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-slate-800">工廠管理</h2>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button 
              className="bg-blue-600 hover:bg-blue-700"
              onClick={() => {
                setEditingFactory(null);
                form.reset({
                  name: '',
                  contact_person: '',
                  email: '',
                  phone: '',
                  address: '',
                });
              }}
            >
              <Plus size={16} className="mr-2" />
              新增工廠
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle>{editingFactory ? '編輯工廠' : '新增工廠'}</DialogTitle>
              <DialogDescription>
                {editingFactory ? '修改工廠/供應商資訊' : '建立新的工廠/供應商檔案'}
              </DialogDescription>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>工廠名稱 *</FormLabel>
                      <FormControl>
                        <Input placeholder="請輸入工廠名稱" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={form.control}
                  name="contact_person"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>聯絡人</FormLabel>
                      <FormControl>
                        <Input placeholder="請輸入聯絡人姓名" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>電子郵件</FormLabel>
                        <FormControl>
                          <Input type="email" placeholder="example@email.com" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="phone"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>電話</FormLabel>
                        <FormControl>
                          <Input placeholder="請輸入電話號碼" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="address"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>地址</FormLabel>
                      <FormControl>
                        <Textarea placeholder="請輸入完整地址" {...field} />
                      </FormControl>
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
                    {editingFactory ? '更新' : '新增'}
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
              placeholder="搜尋工廠名稱、聯絡人或電子郵件..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
        </CardContent>
      </Card>

      {/* 工廠列表 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center">
            <Factory className="mr-2" size={20} />
            工廠列表
          </CardTitle>
          <CardDescription>
            管理工廠/供應商資訊，共 {filteredFactories.length} 家工廠
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-8">
              <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
              <p className="text-slate-600">載入中...</p>
            </div>
          ) : filteredFactories.length === 0 ? (
            <div className="text-center py-8">
              <Factory size={48} className="mx-auto text-slate-400 mb-4" />
              <h3 className="text-lg font-semibold text-slate-600 mb-2">
                {searchTerm ? '沒有找到符合的工廠' : '尚未新增工廠'}
              </h3>
              <p className="text-slate-500">
                {searchTerm ? '請嘗試調整搜尋條件' : '點擊「新增工廠」開始建立工廠檔案'}
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>工廠名稱</TableHead>
                  <TableHead>聯絡人</TableHead>
                  <TableHead>電子郵件</TableHead>
                  <TableHead>電話</TableHead>
                  <TableHead>地址</TableHead>
                  <TableHead>建立時間</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredFactories.map((factory) => (
                  <TableRow key={factory.id}>
                    <TableCell className="font-medium">{factory.name}</TableCell>
                    <TableCell>{factory.contact_person || '-'}</TableCell>
                    <TableCell>
                      {factory.email ? (
                        <div className="flex items-center">
                          <Mail size={14} className="mr-1 text-slate-400" />
                          {factory.email}
                        </div>
                      ) : '-'}
                    </TableCell>
                    <TableCell>
                      {factory.phone ? (
                        <div className="flex items-center">
                          <Phone size={14} className="mr-1 text-slate-400" />
                          {factory.phone}
                        </div>
                      ) : '-'}
                    </TableCell>
                    <TableCell>
                      {factory.address ? (
                        <div className="flex items-center max-w-xs">
                          <MapPin size={14} className="mr-1 text-slate-400 flex-shrink-0" />
                          <span className="truncate">{factory.address}</span>
                        </div>
                      ) : '-'}
                    </TableCell>
                    <TableCell>{new Date(factory.created_at).toLocaleDateString('zh-TW')}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end space-x-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleEdit(factory)}
                        >
                          <Edit size={14} className="mr-1" />
                          編輯
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => handleDelete(factory)}
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

export default FactoryManagement;
