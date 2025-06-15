
import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Plus, Edit, Trash2, Search, Phone, Mail, MapPin } from 'lucide-react';

interface Customer {
  id: string;
  name: string;
  contactPerson: string;
  email: string;
  phone: string;
  address: string;
  orderCount: number;
  totalAmount: string;
  lastOrderDate: string;
}

const CustomerManagement = () => {
  const [customers] = useState<Customer[]>([
    {
      id: '1',
      name: '永豐紡織有限公司',
      contactPerson: '王大明',
      email: 'contact@yongfeng.com',
      phone: '02-2345-6789',
      address: '台北市中山區民生東路123號',
      orderCount: 25,
      totalAmount: '¥1,250,000',
      lastOrderDate: '2025-01-14'
    },
    {
      id: '2',
      name: '昌隆實業股份有限公司',
      contactPerson: '李小華',
      email: 'info@changlong.com',
      phone: '03-456-7890',
      address: '桃園市桃園區中正路456號',
      orderCount: 18,
      totalAmount: '¥890,000',
      lastOrderDate: '2025-01-12'
    },
    {
      id: '3',
      name: '宏達布料工廠',
      contactPerson: '陳志明',
      email: 'sales@hongda.com',
      phone: '04-567-8901',
      address: '台中市西屯區台灣大道789號',
      orderCount: 32,
      totalAmount: '¥1,680,000',
      lastOrderDate: '2025-01-15'
    }
  ]);

  const [searchTerm, setSearchTerm] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);

  const filteredCustomers = customers.filter(customer =>
    customer.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    customer.contactPerson.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-slate-800">客戶管理</h2>
        <Button onClick={() => setShowAddForm(true)} className="bg-blue-600 hover:bg-blue-700">
          <Plus size={16} className="mr-2" />
          新增客戶
        </Button>
      </div>

      {/* 搜尋 */}
      <Card>
        <CardContent className="p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400" size={16} />
            <Input
              placeholder="搜尋客戶名稱或聯絡人..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
        </CardContent>
      </Card>

      {/* 客戶列表 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {filteredCustomers.map((customer) => (
          <Card key={customer.id} className="hover:shadow-lg transition-shadow">
            <CardHeader className="pb-3">
              <div className="flex justify-between items-start">
                <div>
                  <CardTitle className="text-lg">{customer.name}</CardTitle>
                  <CardDescription>聯絡人: {customer.contactPerson}</CardDescription>
                </div>
                <div className="flex space-x-2">
                  <Button variant="outline" size="sm">
                    <Edit size={14} />
                  </Button>
                  <Button variant="outline" size="sm" className="text-red-600 hover:text-red-700">
                    <Trash2 size={14} />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center space-x-2 text-sm">
                  <Mail size={14} className="text-slate-400" />
                  <span className="text-slate-600">{customer.email}</span>
                </div>
                <div className="flex items-center space-x-2 text-sm">
                  <Phone size={14} className="text-slate-400" />
                  <span className="text-slate-600">{customer.phone}</span>
                </div>
                <div className="flex items-start space-x-2 text-sm">
                  <MapPin size={14} className="text-slate-400 mt-0.5" />
                  <span className="text-slate-600">{customer.address}</span>
                </div>
              </div>
              
              <div className="grid grid-cols-3 gap-4 pt-3 border-t border-slate-100">
                <div className="text-center">
                  <p className="text-sm text-slate-600">訂單數量</p>
                  <p className="text-lg font-semibold text-blue-600">{customer.orderCount}</p>
                </div>
                <div className="text-center">
                  <p className="text-sm text-slate-600">總金額</p>
                  <p className="text-lg font-semibold text-green-600">{customer.totalAmount}</p>
                </div>
                <div className="text-center">
                  <p className="text-sm text-slate-600">最後訂單</p>
                  <p className="text-sm font-medium text-slate-800">{customer.lastOrderDate}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* 新增客戶表單 */}
      {showAddForm && (
        <Card className="border-blue-200 bg-blue-50">
          <CardHeader>
            <CardTitle>新增客戶</CardTitle>
            <CardDescription>請填入新客戶的詳細資訊</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="customerName">公司名稱</Label>
                <Input id="customerName" placeholder="輸入公司名稱" />
              </div>
              <div>
                <Label htmlFor="contactPerson">聯絡人</Label>
                <Input id="contactPerson" placeholder="輸入聯絡人姓名" />
              </div>
              <div>
                <Label htmlFor="email">電子郵件</Label>
                <Input id="email" type="email" placeholder="輸入電子郵件" />
              </div>
              <div>
                <Label htmlFor="phone">電話號碼</Label>
                <Input id="phone" placeholder="輸入電話號碼" />
              </div>
            </div>
            <div>
              <Label htmlFor="address">地址</Label>
              <Input id="address" placeholder="輸入完整地址" />
            </div>
            <div className="flex justify-end space-x-3">
              <Button variant="outline" onClick={() => setShowAddForm(false)}>
                取消
              </Button>
              <Button onClick={() => setShowAddForm(false)}>
                儲存客戶
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default CustomerManagement;
