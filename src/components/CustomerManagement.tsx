
import React, { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { Plus, Edit, Trash2, Search, Users, Mail, Phone, MapPin } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

const customerSchema = z.object({
  name: z.string().min(1, '客戶名稱為必填'),
  contact_person: z.string().optional(),
  email: z.string().email('請輸入有效的電子郵件').optional().or(z.literal('')),
  phone: z.string().optional(),
  address: z.string().optional(),
});

type CustomerFormData = z.infer<typeof customerSchema>;
type Customer = {
  id: string;
  name: string;
  contact_person: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  created_at: string;
  updated_at: string;
};

const CustomerManagement = () => {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();

  const form = useForm<CustomerFormData>({
    resolver: zodResolver(customerSchema),
    defaultValues: {
      name: '',
      contact_person: '',
      email: '',
      phone: '',
      address: '',
    },
  });

  const loadCustomers = async () => {
    try {
      const { data, error } = await supabase
        .from('customers')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setCustomers(data || []);
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
    loadCustomers();
  }, []);

  const onSubmit = async (data: CustomerFormData) => {
    setSubmitting(true);
    
    try {
      const customerData = {
        name: data.name,
        contact_person: data.contact_person || null,
        email: data.email || null,
        phone: data.phone || null,
        address: data.address || null,
      };

      if (editingCustomer) {
        const { error } = await supabase
          .from('customers')
          .update(customerData)
          .eq('id', editingCustomer.id);

        if (error) throw error;

        toast({
          title: "更新成功",
          description: `客戶「${data.name}」已更新`,
        });
      } else {
        const { error } = await supabase
          .from('customers')
          .insert([customerData]);

        if (error) throw error;

        toast({
          title: "新增成功",
          description: `客戶「${data.name}」已新增`,
        });
      }

      form.reset();
      setEditingCustomer(null);
      setIsDialogOpen(false);
      loadCustomers();
    } catch (error: any) {
      toast({
        title: editingCustomer ? "更新失敗" : "新增失敗",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (customer: Customer) => {
    try {
      const { error } = await supabase
        .from('customers')
        .delete()
        .eq('id', customer.id);

      if (error) throw error;

      toast({
        title: "刪除成功",
        description: `客戶「${customer.name}」已刪除`,
      });

      loadCustomers();
    } catch (error: any) {
      toast({
        title: "刪除失敗",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const handleEdit = (customer: Customer) => {
    setEditingCustomer(customer);
    form.reset({
      name: customer.name,
      contact_person: customer.contact_person || '',
      email: customer.email || '',
      phone: customer.phone || '',
      address: customer.address || '',
    });
    setIsDialogOpen(true);
  };

  const handleAddNew = () => {
    setEditingCustomer(null);
    form.reset({
      name: '',
      contact_person: '',
      email: '',
      phone: '',
      address: '',
    });
    setIsDialogOpen(true);
  };

  const filteredCustomers = customers.filter(customer =>
    customer.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (customer.contact_person && customer.contact_person.toLowerCase().includes(searchTerm.toLowerCase())) ||
    (customer.email && customer.email.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-slate-800">客戶管理</h2>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button 
              className="bg-blue-600 hover:bg-blue-700 text-white"
              onClick={handleAddNew}
            >
              <Plus size={16} className="mr-2" />
              新增客戶
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[425px] bg-white border border-gray-200">
            <DialogHeader>
              <DialogTitle className="text-gray-900">
                {editingCustomer ? '編輯客戶' : '新增客戶'}
              </DialogTitle>
              <DialogDescription className="text-gray-600">
                {editingCustomer ? '修改客戶資訊' : '建立新的客戶檔案'}
              </DialogDescription>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-gray-700">客戶名稱 *</FormLabel>
                      <FormControl>
                        <Input 
                          placeholder="請輸入客戶名稱" 
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
                  name="contact_person"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-gray-700">聯絡人</FormLabel>
                      <FormControl>
                        <Input 
                          placeholder="請輸入聯絡人姓名" 
                          className="bg-white border-gray-300 text-gray-900 focus:border-blue-500 focus:ring-blue-500"
                          {...field} 
                        />
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
                        <FormLabel className="text-gray-700">電子郵件</FormLabel>
                        <FormControl>
                          <Input 
                            type="email" 
                            placeholder="example@email.com" 
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
                    name="phone"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-gray-700">電話</FormLabel>
                        <FormControl>
                          <Input 
                            placeholder="請輸入電話號碼" 
                            className="bg-white border-gray-300 text-gray-900 focus:border-blue-500 focus:ring-blue-500"
                            {...field} 
                          />
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
                      <FormLabel className="text-gray-700">地址</FormLabel>
                      <FormControl>
                        <Textarea 
                          placeholder="請輸入完整地址" 
                          className="bg-white border-gray-300 text-gray-900 focus:border-blue-500 focus:ring-blue-500"
                          {...field} 
                        />
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
                    disabled={submitting}
                    className="border-gray-300 text-gray-700 hover:bg-gray-50 hover:text-gray-900"
                  >
                    取消
                  </Button>
                  <Button 
                    type="submit" 
                    disabled={submitting}
                    className="bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
                  >
                    {submitting ? '處理中...' : (editingCustomer ? '更新' : '新增')}
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
              placeholder="搜尋客戶名稱、聯絡人或電子郵件..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
        </CardContent>
      </Card>

      {/* 客戶列表 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center">
            <Users className="mr-2" size={20} />
            客戶列表
          </CardTitle>
          <CardDescription>
            管理客戶資訊，共 {filteredCustomers.length} 位客戶
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-8">
              <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
              <p className="text-slate-600">載入中...</p>
            </div>
          ) : filteredCustomers.length === 0 ? (
            <div className="text-center py-8">
              <Users size={48} className="mx-auto text-slate-400 mb-4" />
              <h3 className="text-lg font-semibold text-slate-600 mb-2">
                {searchTerm ? '沒有找到符合的客戶' : '尚未新增客戶'}
              </h3>
              <p className="text-slate-500">
                {searchTerm ? '請嘗試調整搜尋條件' : '點擊「新增客戶」開始建立客戶檔案'}
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>客戶名稱</TableHead>
                  <TableHead>聯絡人</TableHead>
                  <TableHead>電子郵件</TableHead>
                  <TableHead>電話</TableHead>
                  <TableHead>地址</TableHead>
                  <TableHead>建立時間</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredCustomers.map((customer) => (
                  <TableRow key={customer.id}>
                    <TableCell className="font-medium">{customer.name}</TableCell>
                    <TableCell>{customer.contact_person || '-'}</TableCell>
                    <TableCell>
                      {customer.email ? (
                        <div className="flex items-center">
                          <Mail size={14} className="mr-1 text-slate-400" />
                          {customer.email}
                        </div>
                      ) : '-'}
                    </TableCell>
                    <TableCell>
                      {customer.phone ? (
                        <div className="flex items-center">
                          <Phone size={14} className="mr-1 text-slate-400" />
                          {customer.phone}
                        </div>
                      ) : '-'}
                    </TableCell>
                    <TableCell>
                      {customer.address ? (
                        <div className="flex items-center max-w-xs">
                          <MapPin size={14} className="mr-1 text-slate-400 flex-shrink-0" />
                          <span className="truncate">{customer.address}</span>
                        </div>
                      ) : '-'}
                    </TableCell>
                    <TableCell>{new Date(customer.created_at).toLocaleDateString('zh-TW')}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end space-x-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleEdit(customer)}
                        >
                          <Edit size={14} className="mr-1" />
                          編輯
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              size="sm"
                              variant="destructive"
                            >
                              <Trash2 size={14} className="mr-1" />
                              刪除
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent className="bg-white">
                            <AlertDialogHeader>
                              <AlertDialogTitle>確認刪除客戶</AlertDialogTitle>
                              <AlertDialogDescription>
                                您確定要刪除客戶「{customer.name}」嗎？
                                <br />
                                <span className="text-red-600 font-medium">此操作無法復原！</span>
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>取消</AlertDialogCancel>
                              <AlertDialogAction 
                                onClick={() => handleDelete(customer)}
                                className="bg-red-600 hover:bg-red-700"
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

export default CustomerManagement;
