import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Plus, Edit, Trash } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { EnhancedTable, TableColumn } from '@/components/ui/enhanced-table';

interface Factory {
  id: string;
  name: string;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  created_at: string;
}

const FactoryManagement = () => {
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [editingFactory, setEditingFactory] = useState<Factory | null>(null);
  const [newFactory, setNewFactory] = useState({
    name: '',
    contact_person: '',
    phone: '',
    email: '',
    address: ''
  });

  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: factories, isLoading, error, refetch } = useQuery({
    queryKey: ['factories'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('factories')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching factories:', error);
        throw error;
      }

      return data as Factory[];
    }
  });

  const createFactoryMutation = useMutation({
    mutationFn: async (newFactory: Omit<Factory, 'id' | 'created_at'>) => {
      const { data, error } = await supabase
        .from('factories')
        .insert([newFactory])
        .select()
        .single();

      if (error) {
        console.error('Error creating factory:', error);
        throw error;
      }

      return data as Factory;
    },
    onSuccess: () => {
      toast({
        title: "成功",
        description: "工廠已成功建立",
      });
      queryClient.invalidateQueries({ queryKey: ['factories'] });
      setNewFactory({
        name: '',
        contact_person: '',
        phone: '',
        email: '',
        address: ''
      });
      setIsCreateDialogOpen(false);
    },
    onError: (error) => {
      console.error('Error creating factory:', error);
      toast({
        title: "錯誤",
        description: "建立工廠時發生錯誤",
        variant: "destructive",
      });
    },
  });

  const updateFactoryMutation = useMutation({
    mutationFn: async (factory: Factory) => {
      const { data, error } = await supabase
        .from('factories')
        .update(factory)
        .eq('id', factory.id)
        .select()
        .single();

      if (error) {
        console.error('Error updating factory:', error);
        throw error;
      }

      return data as Factory;
    },
    onSuccess: () => {
      toast({
        title: "成功",
        description: "工廠已成功更新",
      });
      queryClient.invalidateQueries({ queryKey: ['factories'] });
      setEditingFactory(null);
      refetch();
    },
    onError: (error) => {
      console.error('Error updating factory:', error);
      toast({
        title: "錯誤",
        description: "更新工廠時發生錯誤",
        variant: "destructive",
      });
    },
  });

  const deleteFactoryMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('factories')
        .delete()
        .eq('id', id);

      if (error) {
        console.error('Error deleting factory:', error);
        throw error;
      }
    },
    onSuccess: () => {
      toast({
        title: "成功",
        description: "工廠已成功刪除",
      });
      queryClient.invalidateQueries({ queryKey: ['factories'] });
      refetch();
    },
    onError: (error) => {
      console.error('Error deleting factory:', error);
      toast({
        title: "錯誤",
        description: "刪除工廠時發生錯誤",
        variant: "destructive",
      });
    },
  });

  const columns: TableColumn[] = [
    {
      key: 'name',
      title: '工廠名稱',
      sortable: true,
      filterable: false,
      render: (value) => <span className="font-medium text-gray-900">{value}</span>
    },
    {
      key: 'contact_person',
      title: '聯絡人',
      sortable: true,
      filterable: false,
      render: (value) => <span className="text-gray-800">{value || '-'}</span>
    },
    {
      key: 'phone',
      title: '電話',
      sortable: true,
      filterable: false,
      render: (value) => <span className="text-gray-800">{value || '-'}</span>
    },
    {
      key: 'email',
      title: 'Email',
      sortable: true,
      filterable: false,
      render: (value) => <span className="text-gray-800">{value || '-'}</span>
    },
    {
      key: 'address',
      title: '地址',
      sortable: true,
      filterable: false,
      render: (value) => <span className="text-gray-800">{value || '-'}</span>
    },
    {
      key: 'actions',
      title: '操作',
      sortable: false,
      filterable: false,
      render: (value, row) => (
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setEditingFactory(row)}
            className="text-gray-800 hover:text-gray-900 hover:bg-gray-100 border-gray-300"
          >
            <Edit className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => deleteFactoryMutation.mutate(row.id)}
            className="text-red-600 hover:text-red-800 hover:bg-gray-100 border-gray-300"
          >
            <Trash className="h-4 w-4" />
          </Button>
        </div>
      )
    }
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-900">工廠管理</h2>
        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button className="bg-blue-600 text-white hover:bg-blue-700 border-0 shadow-sm">
              <Plus className="mr-2 h-4 w-4" />
              新增工廠
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle className="text-gray-900">新增工廠</DialogTitle>
              <DialogDescription className="text-gray-700">
                建立新的工廠資料
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="name" className="text-right text-gray-800">
                  工廠名稱
                </Label>
                <Input
                  type="text"
                  id="name"
                  value={newFactory.name}
                  onChange={(e) => setNewFactory({ ...newFactory, name: e.target.value })}
                  className="col-span-3 border-gray-300 text-gray-900"
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="contact_person" className="text-right text-gray-800">
                  聯絡人
                </Label>
                <Input
                  type="text"
                  id="contact_person"
                  value={newFactory.contact_person || ''}
                  onChange={(e) => setNewFactory({ ...newFactory, contact_person: e.target.value })}
                  className="col-span-3 border-gray-300 text-gray-900"
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="phone" className="text-right text-gray-800">
                  電話
                </Label>
                <Input
                  type="tel"
                  id="phone"
                  value={newFactory.phone || ''}
                  onChange={(e) => setNewFactory({ ...newFactory, phone: e.target.value })}
                  className="col-span-3 border-gray-300 text-gray-900"
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="email" className="text-right text-gray-800">
                  Email
                </Label>
                <Input
                  type="email"
                  id="email"
                  value={newFactory.email || ''}
                  onChange={(e) => setNewFactory({ ...newFactory, email: e.target.value })}
                  className="col-span-3 border-gray-300 text-gray-900"
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="address" className="text-right text-gray-800">
                  地址
                </Label>
                <Input
                  type="text"
                  id="address"
                  value={newFactory.address || ''}
                  onChange={(e) => setNewFactory({ ...newFactory, address: e.target.value })}
                  className="col-span-3 border-gray-300 text-gray-900"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
                取消
              </Button>
              <Button onClick={() => createFactoryMutation.mutate(newFactory)}>
                建立
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card className="border-gray-200 shadow-sm">
        <CardHeader className="border-b border-gray-100">
          <CardTitle className="text-gray-900">工廠列表</CardTitle>
          <CardDescription className="text-gray-600">
            管理工廠資料
          </CardDescription>
        </CardHeader>
        <CardContent className="p-6">
          <EnhancedTable
            columns={columns}
            data={factories || []}
            loading={isLoading}
            searchPlaceholder="搜尋工廠名稱、聯絡人、電話..."
            emptyMessage={error ? '載入工廠資料時發生錯誤' : '尚無工廠'}
          />
        </CardContent>
      </Card>

      <Dialog open={!!editingFactory} onOpenChange={(open) => !open && setEditingFactory(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-gray-900">編輯工廠</DialogTitle>
            <DialogDescription className="text-gray-700">
              編輯工廠資料
            </DialogDescription>
          </DialogHeader>

          {editingFactory && (
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="name" className="text-right text-gray-800">
                  工廠名稱
                </Label>
                <Input
                  type="text"
                  id="name"
                  value={editingFactory.name}
                  onChange={(e) => setEditingFactory({ ...editingFactory, name: e.target.value })}
                  className="col-span-3 border-gray-300 text-gray-900"
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="contact_person" className="text-right text-gray-800">
                  聯絡人
                </Label>
                <Input
                  type="text"
                  id="contact_person"
                  value={editingFactory.contact_person || ''}
                  onChange={(e) => setEditingFactory({ ...editingFactory, contact_person: e.target.value })}
                  className="col-span-3 border-gray-300 text-gray-900"
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="phone" className="text-right text-gray-800">
                  電話
                </Label>
                <Input
                  type="tel"
                  id="phone"
                  value={editingFactory.phone || ''}
                  onChange={(e) => setEditingFactory({ ...editingFactory, phone: e.target.value })}
                  className="col-span-3 border-gray-300 text-gray-900"
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="email" className="text-right text-gray-800">
                  Email
                </Label>
                <Input
                  type="email"
                  id="email"
                  value={editingFactory.email || ''}
                  onChange={(e) => setEditingFactory({ ...editingFactory, email: e.target.value })}
                  className="col-span-3 border-gray-300 text-gray-900"
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="address" className="text-right text-gray-800">
                  地址
                </Label>
                <Input
                  type="text"
                  id="address"
                  value={editingFactory.address || ''}
                  onChange={(e) => setEditingFactory({ ...editingFactory, address: e.target.value })}
                  className="col-span-3 border-gray-300 text-gray-900"
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingFactory(null)}>
              取消
            </Button>
            <Button onClick={() => editingFactory && updateFactoryMutation.mutate(editingFactory)}>
              更新
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default FactoryManagement;
