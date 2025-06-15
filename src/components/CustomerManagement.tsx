import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, Search, Edit, Trash } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface Customer {
  id: string;
  name: string;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  created_at: string;
}

const CustomerManagement = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [newCustomer, setNewCustomer] = useState({
    name: '',
    contact_person: '',
    phone: '',
    email: '',
    address: ''
  });

  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: customers, isLoading, error } = useQuery({
    queryKey: ['customers'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('customers')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching customers:', error);
        throw error;
      }

      return data as Customer[];
    }
  });

  const createCustomerMutation = useMutation({
    mutationFn: async (newCustomer: Omit<Customer, 'id' | 'created_at'>) => {
      const { data, error } = await supabase
        .from('customers')
        .insert([newCustomer]);

      if (error) {
        console.error('Error creating customer:', error);
        throw error;
      }

      return data;
    },
    onSuccess: () => {
      toast({
        title: "成功",
        description: "客戶已成功建立",
      });
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      setIsCreateDialogOpen(false);
      setNewCustomer({
        name: '',
        contact_person: '',
        phone: '',
        email: '',
        address: ''
      });
    },
    onError: (error) => {
      console.error('Error creating customer:', error);
      toast({
        title: "錯誤",
        description: "建立客戶時發生錯誤",
        variant: "destructive",
      });
    },
  });

  const updateCustomerMutation = useMutation({
    mutationFn: async (customer: Customer) => {
      const { data, error } = await supabase
        .from('customers')
        .update(customer)
        .eq('id', customer.id);

      if (error) {
        console.error('Error updating customer:', error);
        throw error;
      }

      return data;
    },
    onSuccess: () => {
      toast({
        title: "成功",
        description: "客戶已成功更新",
      });
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      setEditingCustomer(null);
    },
    onError: (error) => {
      console.error('Error updating customer:', error);
      toast({
        title: "錯誤",
        description: "更新客戶時發生錯誤",
        variant: "destructive",
      });
    },
  });

  const deleteCustomerMutation = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase
        .from('customers')
        .delete()
        .eq('id', id);

      if (error) {
        console.error('Error deleting customer:', error);
        throw error;
      }

      return data;
    },
    onSuccess: () => {
      toast({
        title: "成功",
        description: "客戶已成功刪除",
      });
      queryClient.invalidateQueries({ queryKey: ['customers'] });
    },
    onError: (error) => {
      console.error('Error deleting customer:', error);
      toast({
        title: "錯誤",
        description: "刪除客戶時發生錯誤",
        variant: "destructive",
      });
    },
  });

  const filteredCustomers = customers?.filter(customer =>
    customer.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (customer.contact_person?.toLowerCase().includes(searchTerm.toLowerCase()) ?? false) ||
    (customer.phone?.toLowerCase().includes(searchTerm.toLowerCase()) ?? false)
  );

  const handleCreateCustomer = async () => {
    createCustomerMutation.mutate(newCustomer);
  };

  const handleUpdateCustomer = async (customer: Customer) => {
    updateCustomerMutation.mutate(customer);
  };

  const handleDeleteCustomer = async (id: string) => {
    deleteCustomerMutation.mutate(id);
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-900">客戶管理</h2>
        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button className="bg-blue-600 text-white hover:bg-blue-700 border-0 shadow-sm">
              <Plus className="mr-2 h-4 w-4" />
              新增客戶
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle className="text-gray-900">新增客戶</DialogTitle>
              <DialogDescription className="text-gray-700">
                建立新的客戶資料
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="name" className="text-right text-gray-800">
                  客戶名稱
                </Label>
                <Input
                  id="name"
                  value={newCustomer.name}
                  onChange={(e) => setNewCustomer({ ...newCustomer, name: e.target.value })}
                  className="col-span-3 border-gray-300 text-gray-900"
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="contact_person" className="text-right text-gray-800">
                  聯絡人
                </Label>
                <Input
                  id="contact_person"
                  value={newCustomer.contact_person}
                  onChange={(e) => setNewCustomer({ ...newCustomer, contact_person: e.target.value })}
                  className="col-span-3 border-gray-300 text-gray-900"
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="phone" className="text-right text-gray-800">
                  電話
                </Label>
                <Input
                  id="phone"
                  value={newCustomer.phone}
                  onChange={(e) => setNewCustomer({ ...newCustomer, phone: e.target.value })}
                  className="col-span-3 border-gray-300 text-gray-900"
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="email" className="text-right text-gray-800">
                  Email
                </Label>
                <Input
                  id="email"
                  type="email"
                  value={newCustomer.email}
                  onChange={(e) => setNewCustomer({ ...newCustomer, email: e.target.value })}
                  className="col-span-3 border-gray-300 text-gray-900"
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="address" className="text-right text-gray-800">
                  地址
                </Label>
                <Input
                  id="address"
                  value={newCustomer.address}
                  onChange={(e) => setNewCustomer({ ...newCustomer, address: e.target.value })}
                  className="col-span-3 border-gray-300 text-gray-900"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
                取消
              </Button>
              <Button onClick={handleCreateCustomer} disabled={createCustomerMutation.isPending}>
                {createCustomerMutation.isPending ? '建立中...' : '建立客戶'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card className="border-gray-200 shadow-sm">
        <CardHeader className="border-b border-gray-100">
          <CardTitle className="text-gray-900">客戶列表</CardTitle>
          <CardDescription className="text-gray-600">
            管理客戶資料
          </CardDescription>
        </CardHeader>
        <CardContent className="p-6">
          <div className="mb-4">
            <div className="relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-gray-500" />
              <Input
                placeholder="搜尋客戶名稱、聯絡人或電話..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 border-gray-300 text-gray-900 placeholder:text-gray-500 focus:border-blue-500 focus:ring-blue-500"
              />
            </div>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-gray-900 font-semibold">客戶名稱</TableHead>
                <TableHead className="text-gray-900 font-semibold">聯絡人</TableHead>
                <TableHead className="text-gray-900 font-semibold">電話</TableHead>
                <TableHead className="text-gray-900 font-semibold">Email</TableHead>
                <TableHead className="text-gray-900 font-semibold">地址</TableHead>
                <TableHead className="text-gray-900 font-semibold">建立時間</TableHead>
                <TableHead className="text-gray-900 font-semibold">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredCustomers?.map((customer) => (
                <TableRow key={customer.id} className="hover:bg-gray-50">
                  <TableCell className="font-medium text-gray-900">{customer.name}</TableCell>
                  <TableCell className="text-gray-800">{customer.contact_person}</TableCell>
                  <TableCell className="text-gray-800">{customer.phone}</TableCell>
                  <TableCell className="text-gray-800">{customer.email}</TableCell>
                  <TableCell className="text-gray-800">{customer.address}</TableCell>
                  <TableCell className="text-gray-800">{new Date(customer.created_at).toLocaleDateString('zh-TW')}</TableCell>
                  <TableCell>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setEditingCustomer(customer)}
                      className="text-gray-800 hover:text-gray-900 hover:bg-gray-100 border-gray-300"
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleDeleteCustomer(customer.id)}
                      className="text-red-600 hover:text-red-800 hover:bg-gray-100 border-gray-300 ml-2"
                    >
                      <Trash className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {filteredCustomers?.length === 0 && (
            <div className="text-center py-8 text-gray-600">
              {searchTerm ? '沒有找到符合條件的客戶' : '尚無客戶'}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!editingCustomer} onOpenChange={(open) => !open && setEditingCustomer(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-gray-900">編輯客戶</DialogTitle>
            <DialogDescription className="text-gray-700">
              修改客戶資料
            </DialogDescription>
          </DialogHeader>
          {editingCustomer && (
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="name" className="text-right text-gray-800">
                  客戶名稱
                </Label>
                <Input
                  id="name"
                  value={editingCustomer.name}
                  onChange={(e) => setEditingCustomer({ ...editingCustomer, name: e.target.value })}
                  className="col-span-3 border-gray-300 text-gray-900"
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="contact_person" className="text-right text-gray-800">
                  聯絡人
                </Label>
                <Input
                  id="contact_person"
                  value={editingCustomer.contact_person || ''}
                  onChange={(e) => setEditingCustomer({ ...editingCustomer, contact_person: e.target.value })}
                  className="col-span-3 border-gray-300 text-gray-900"
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="phone" className="text-right text-gray-800">
                  電話
                </Label>
                <Input
                  id="phone"
                  value={editingCustomer.phone || ''}
                  onChange={(e) => setEditingCustomer({ ...editingCustomer, phone: e.target.value })}
                  className="col-span-3 border-gray-300 text-gray-900"
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="email" className="text-right text-gray-800">
                  Email
                </Label>
                <Input
                  id="email"
                  type="email"
                  value={editingCustomer.email || ''}
                  onChange={(e) => setEditingCustomer({ ...editingCustomer, email: e.target.value })}
                  className="col-span-3 border-gray-300 text-gray-900"
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="address" className="text-right text-gray-800">
                  地址
                </Label>
                <Input
                  id="address"
                  value={editingCustomer.address || ''}
                  onChange={(e) => setEditingCustomer({ ...editingCustomer, address: e.target.value })}
                  className="col-span-3 border-gray-300 text-gray-900"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingCustomer(null)}>
              取消
            </Button>
            <Button onClick={() => editingCustomer && handleUpdateCustomer(editingCustomer)} disabled={updateCustomerMutation.isPending}>
              {updateCustomerMutation.isPending ? '更新中...' : '更新客戶'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default CustomerManagement;
