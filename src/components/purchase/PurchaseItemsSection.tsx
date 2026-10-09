
import React from 'react';
import { Label } from '@/components/ui/label';
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
  itemErrors?: { [index: number]: { product_id?: string; ordered_quantity?: string; unit_price?: string } };
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
  itemErrors,
}) => {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Label className="text-gray-800">採購項目 *</Label>
        <Button
            type="button"
            variant="outline"
            onClick={addItem}
            className="border-gray-300 text-gray-700 hover:bg-gray-50" size="icon" aria-label="新增項目" title="新增項目">
            <Plus className="h-4 w-4" />
        </Button>
      </div>
      <div className="space-y-4">
        {items.map((item, index) => {
          const itemFieldErrors = itemErrors?.[index];
          return (
            <PurchaseItemForm
              key={`item-${index}`}
              item={item}
              index={index}
              products={products}
              uniqueProductNames={uniqueProductNames}
              getColorVariants={getColorVariants}
              updateItem={updateItem}
              removeItem={removeItem}
              canRemove={items.length > 1}
              productNameOpen={productNameOpens[index] || false}
              setProductNameOpen={(open) => {
                setProductNameOpens({ ...productNameOpens, [index]: open });
              }}
              colorOpen={colorOpens[index] || false}
              setColorOpen={(open) => {
                setColorOpens({ ...colorOpens, [index]: open });
              }}
              errors={itemFieldErrors}
            />
          );
        })}
      </div>
    </div>
  );
};
