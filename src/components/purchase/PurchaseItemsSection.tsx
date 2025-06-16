
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import { PurchaseItemForm } from './PurchaseItemForm';
import { PurchaseItem } from './types';

interface Product {
  id: string;
  name: string;
  color: string | null;
  color_code: string | null;
}

interface PurchaseItemsSectionProps {
  items: PurchaseItem[];
  products?: Product[];
  uniqueProductNames: string[];
  getColorVariants: (productName: string) => Product[];
  addItem: () => void;
  removeItem: (index: number) => void;
  updateItem: (index: number, field: keyof PurchaseItem, value: any) => void;
  productNameOpens: Record<number, boolean>;
  setProductNameOpens: (opens: Record<number, boolean>) => void;
  colorOpens: Record<number, boolean>;
  setColorOpens: (opens: Record<number, boolean>) => void;
}

export const PurchaseItemsSection: React.FC<PurchaseItemsSectionProps> = ({
  items,
  products,
  uniqueProductNames,
  getColorVariants,
  addItem,
  removeItem,
  updateItem,
  productNameOpens,
  setProductNameOpens,
  colorOpens,
  setColorOpens,
}) => {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-gray-900 flex items-center justify-between">
          採購項目
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addItem}
            className="border-gray-300 text-gray-700 hover:bg-gray-50"
          >
            <Plus className="h-4 w-4 mr-1" />
            新增項目
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {items.map((item, index) => (
          <PurchaseItemForm
            key={index}
            item={item}
            index={index}
            products={products}
            uniqueProductNames={uniqueProductNames}
            getColorVariants={getColorVariants}
            updateItem={updateItem}
            removeItem={removeItem}
            canRemove={items.length > 1}
            productNameOpen={productNameOpens[index] || false}
            setProductNameOpen={(open) => setProductNameOpens(prev => ({ ...prev, [index]: open }))}
            colorOpen={colorOpens[index] || false}
            setColorOpen={(open) => setColorOpens(prev => ({ ...prev, [index]: open }))}
          />
        ))}
      </CardContent>
    </Card>
  );
};
