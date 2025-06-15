
import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Plus, Edit, Trash2, Search, Filter } from 'lucide-react';

interface Product {
  id: string;
  name: string;
  category: string;
  color: string;
  colorCode: string;
  unitOfMeasure: string;
  createdAt: string;
}

const ProductManagement = () => {
  const [products] = useState<Product[]>([
    {
      id: '1',
      name: '純棉帆布',
      category: '布料',
      color: '米白',
      colorCode: '#F5F5DC',
      unitOfMeasure: 'KG',
      createdAt: '2025-01-10'
    },
    {
      id: '2',
      name: '聚酯纖維',
      category: '布料',
      color: '深藍',
      colorCode: '#191970',
      unitOfMeasure: 'KG',
      createdAt: '2025-01-12'
    },
    {
      id: '3',
      name: '混紡布料',
      category: '布料',
      color: '灰色',
      colorCode: '#808080',
      unitOfMeasure: 'KG',
      createdAt: '2025-01-14'
    }
  ]);

  const [searchTerm, setSearchTerm] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);

  const filteredProducts = products.filter(product =>
    product.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    product.color.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-slate-800">產品管理</h2>
        <Button onClick={() => setShowAddForm(true)} className="bg-blue-600 hover:bg-blue-700">
          <Plus size={16} className="mr-2" />
          新增產品
        </Button>
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
                  <Button variant="outline" size="sm">
                    <Edit size={14} />
                  </Button>
                  <Button variant="outline" size="sm" className="text-red-600 hover:text-red-700">
                    <Trash2 size={14} />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center space-x-3">
                <div
                  className="w-6 h-6 rounded-full border border-slate-300"
                  style={{ backgroundColor: product.colorCode }}
                ></div>
                <span className="text-sm text-slate-600">{product.color}</span>
                <Badge variant="secondary">{product.colorCode}</Badge>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-600">計量單位:</span>
                <Badge>{product.unitOfMeasure}</Badge>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-600">建立日期:</span>
                <span className="text-slate-800">{product.createdAt}</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* 新增產品表單 */}
      {showAddForm && (
        <Card className="border-blue-200 bg-blue-50">
          <CardHeader>
            <CardTitle>新增產品</CardTitle>
            <CardDescription>請填入新產品的詳細資訊</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="productName">產品名稱</Label>
                <Input id="productName" placeholder="輸入產品名稱" />
              </div>
              <div>
                <Label htmlFor="category">類別</Label>
                <Input id="category" placeholder="布料" />
              </div>
              <div>
                <Label htmlFor="color">顏色</Label>
                <Input id="color" placeholder="輸入顏色" />
              </div>
              <div>
                <Label htmlFor="colorCode">顏色代碼</Label>
                <Input id="colorCode" placeholder="#FFFFFF" />
              </div>
            </div>
            <div className="flex justify-end space-x-3">
              <Button variant="outline" onClick={() => setShowAddForm(false)}>
                取消
              </Button>
              <Button onClick={() => setShowAddForm(false)}>
                儲存產品
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default ProductManagement;
