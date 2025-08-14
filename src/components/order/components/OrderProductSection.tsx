import React from 'react';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Plus, Trash } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Combobox } from '@/components/ui/combobox';

interface Product {
  id: string;
  name: string;
  color: string | null;
  color_code: string | null;
}

interface OrderProduct {
  base_product_name: string;
  product_id: string;
  quantity: number;
  unit_price: number;
  specifications: any;
}

interface OrderProductSectionProps {
  products: OrderProduct[];
  allProducts: Product[];
  onAddProduct: () => void;
  onRemoveProduct: (index: number) => void;
  onUpdateProduct: (index: number, field: keyof OrderProduct, value: any) => void;
  onCreateProduct: () => void;
  note: string;
  onNoteChange: (note: string) => void;
}

export const OrderProductSection: React.FC<OrderProductSectionProps> = ({
  products,
  allProducts,
  onAddProduct,
  onRemoveProduct,
  onUpdateProduct,
  onCreateProduct,
  note,
  onNoteChange,
}) => {
  // Get unique product names
  const uniqueProductNames = [...new Set(allProducts?.map(p => p.name))];

  // Get color variants for a specific product name
  const getColorVariants = (productName: string) => {
    return allProducts?.filter(p => p.name === productName) || [];
  };

  // Prepare product name options for combobox
  const productNameOptions = uniqueProductNames.map(name => ({
    value: name,
    label: name,
  }));

  return (
    <div className="space-y-4">
      {/* Products Section Header */}
      <div className="flex justify-between items-center">
        <Label className="text-gray-800">產品明細 *</Label>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onCreateProduct}
          >
            <Plus className="h-4 w-4 mr-1" />
            新增產品
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={onAddProduct}>
            <Plus className="h-4 w-4 mr-2" />
            新增明細
          </Button>
        </div>
      </div>

      {/* Products List */}
      {products.map((product, index) => {
        const colorVariants = getColorVariants(product.base_product_name);
        // 改善顏色選項顯示：每個色碼都是獨立選項，同時顯示顏色和色碼
        const colorOptions = colorVariants.map(variant => {
          const displayText = variant.color && variant.color_code 
            ? `${variant.color} (${variant.color_code})`
            : variant.color || variant.color_code || '無顏色';
          
          return {
            value: variant.id,
            label: displayText,
            extra: variant.color_code ? (
              <div className="flex items-center space-x-4">
                <div className="flex items-center space-x-2">
                  <div 
                    className="w-3 h-3 rounded border border-gray-400"
                    style={{ backgroundColor: variant.color_code }}
                  ></div>
                  <span className="text-xs text-gray-500">{variant.color_code}</span>
                </div>
                <div className="flex items-center space-x-2">
                  <div 
                    className="w-3 h-3 rounded border border-gray-400"
                    style={{ backgroundColor: variant.color_code }}
                  ></div>
                  <span className="text-xs text-gray-500">{variant.color_code}</span>
                </div>
              </div>
            ) : null,
          };
        });
        
        return (
          <Card key={index} className="border-gray-200">
            <CardContent className="p-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="space-y-2">
                  <Label className="text-gray-800">產品名稱 *</Label>
                  <Combobox
                    options={productNameOptions}
                    value={product.base_product_name}
                    onValueChange={(value) => onUpdateProduct(index, 'base_product_name', value)}
                    placeholder="選擇產品..."
                    searchPlaceholder="搜尋產品..."
                    emptyText="未找到產品"
                    className="w-full"
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-gray-800">顏色/色碼 *</Label>
                  <Combobox
                    options={colorOptions}
                    value={product.product_id}
                    onValueChange={(value) => onUpdateProduct(index, 'product_id', value)}
                    placeholder="選擇顏色/色碼..."
                    searchPlaceholder="搜尋顏色或色碼..."
                    emptyText="未找到顏色"
                    disabled={!product.base_product_name}
                    className="w-full"
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-gray-800">公斤數 *</Label>
                  <Input
                    type="number"
                    value={product.quantity}
                    onChange={(e) => onUpdateProduct(index, 'quantity', parseFloat(e.target.value) || 0)}
                    className="border-gray-200 text-gray-900"
                    min="0"
                    step="0.01"
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-gray-800">單價 (每公斤) *</Label>
                  <Input
                    type="number"
                    value={product.unit_price}
                    onChange={(e) => onUpdateProduct(index, 'unit_price', parseFloat(e.target.value) || 0)}
                    className="border-gray-200 text-gray-900"
                    min="0"
                    step="0.01"
                  />
                </div>
              </div>

              <div className="mt-4 flex justify-between items-center">
                <div className="text-sm text-gray-700">
                  小計: ${(product.quantity * product.unit_price).toLocaleString()}
                </div>
                {products.length > 1 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => onRemoveProduct(index)}
                    className="text-red-600 hover:text-red-800"
                  >
                    <Trash className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}

      {/* Order Note */}
      <div className="space-y-2">
        <Label htmlFor="note" className="text-gray-800">訂單備註</Label>
        <Textarea
          id="note"
          value={note}
          onChange={(e) => onNoteChange(e.target.value)}
          placeholder="輸入訂單備註..."
          className="border-gray-200 text-gray-900"
        />
      </div>

      {/* Order Total */}
      <div className="bg-gray-50 p-4 rounded-lg">
        <div className="text-lg font-semibold text-gray-900">
          訂單總計: ${products.reduce((total, p) => total + (p.quantity * p.unit_price), 0).toLocaleString()}
        </div>
      </div>
    </div>
  );
};