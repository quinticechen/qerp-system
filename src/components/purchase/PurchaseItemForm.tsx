
import React from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Check, ChevronsUpDown, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PurchaseItem } from './types';

interface Product {
  id: string;
  name: string;
  color: string | null;
  color_code: string | null;
}

interface PurchaseItemFormProps {
  item: PurchaseItem;
  index: number;
  products?: Product[];
  uniqueProductNames: string[];
  getColorVariants: (productName: string) => Product[];
  updateItem: (index: number, field: keyof PurchaseItem, value: any) => void;
  removeItem: (index: number) => void;
  canRemove: boolean;
  productNameOpen: boolean;
  setProductNameOpen: (open: boolean) => void;
  colorOpen: boolean;
  setColorOpen: (open: boolean) => void;
}

export const PurchaseItemForm: React.FC<PurchaseItemFormProps> = ({
  item,
  index,
  products,
  uniqueProductNames,
  getColorVariants,
  updateItem,
  removeItem,
  canRemove,
  productNameOpen,
  setProductNameOpen,
  colorOpen,
  setColorOpen,
}) => {
  const colorVariants = getColorVariants(item.selected_product_name || '');

  console.log('PurchaseItemForm - uniqueProductNames:', uniqueProductNames);
  console.log('PurchaseItemForm - products:', products?.length || 0);

  return (
    <div className="border border-gray-200 rounded p-4 space-y-4">
      <div className="flex justify-between items-center">
        <h4 className="font-medium text-gray-900">項目 {index + 1}</h4>
        {canRemove && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => removeItem(index)}
            className="border-red-300 text-red-700 hover:bg-red-50"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="space-y-2">
          <Label className="text-gray-800">產品名稱 *</Label>
          <Popover open={productNameOpen} onOpenChange={setProductNameOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                className="w-full justify-between border-gray-300 text-gray-900 hover:bg-gray-50"
              >
                {item.selected_product_name || "選擇產品名稱..."}
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[--radix-popover-trigger-width] p-0 bg-white shadow-lg border border-gray-200">
              <Command>
                <CommandInput placeholder="搜尋產品名稱..." className="h-9" />
                <CommandList>
                  <CommandEmpty>
                    {uniqueProductNames.length === 0 ? "無產品資料，請先在產品管理中新增產品" : "未找到產品。"}
                  </CommandEmpty>
                  <CommandGroup>
                    {uniqueProductNames.map((name) => (
                      <CommandItem
                        key={name}
                        value={name}
                        onSelect={(currentValue) => {
                          console.log('Selected product name:', currentValue);
                          updateItem(index, 'selected_product_name', currentValue);
                          updateItem(index, 'product_id', '');
                          setProductNameOpen(false);
                        }}
                      >
                        {name}
                        <Check
                          className={cn(
                            "ml-auto h-4 w-4",
                            item.selected_product_name === name ? "opacity-100" : "opacity-0"
                          )}
                        />
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>

        <div className="space-y-2">
          <Label className="text-gray-800">顏色/色碼 *</Label>
          <Popover open={colorOpen} onOpenChange={setColorOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                disabled={!item.selected_product_name}
                className="w-full justify-between border-gray-300 text-gray-900 hover:bg-gray-50"
              >
                {item.product_id ? (
                  (() => {
                    const selectedVariant = colorVariants.find(v => v.id === item.product_id);
                    return selectedVariant ? (
                      <div className="flex items-center space-x-2">
                        {selectedVariant.color_code && (
                          <div 
                            className="w-4 h-4 rounded border border-gray-400"
                            style={{ backgroundColor: selectedVariant.color_code }}
                          ></div>
                        )}
                        <span>
                          {selectedVariant.color || '無顏色'} {selectedVariant.color_code ? `(${selectedVariant.color_code})` : ''}
                        </span>
                      </div>
                    ) : "選擇顏色...";
                  })()
                ) : "選擇顏色..."}
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[--radix-popover-trigger-width] p-0 bg-white shadow-lg border border-gray-200">
              <Command>
                <CommandInput placeholder="搜尋顏色..." className="h-9" />
                <CommandList>
                  <CommandEmpty>未找到顏色。</CommandEmpty>
                  <CommandGroup>
                    {colorVariants.map((variant) => (
                      <CommandItem
                        key={variant.id}
                        value={`${variant.color || '無顏色'} ${variant.color_code || ''}`}
                        onSelect={() => {
                          updateItem(index, 'product_id', variant.id);
                          setColorOpen(false);
                        }}
                      >
                        <div className="flex items-center space-x-2">
                          {variant.color_code && (
                            <div 
                              className="w-4 h-4 rounded border border-gray-400"
                              style={{ backgroundColor: variant.color_code }}
                            ></div>
                          )}
                          <span>
                            {variant.color || '無顏色'} {variant.color_code ? `(${variant.color_code})` : ''}
                          </span>
                        </div>
                        <Check
                          className={cn(
                            "ml-auto h-4 w-4",
                            item.product_id === variant.id ? "opacity-100" : "opacity-0"
                          )}
                        />
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>

        <div className="space-y-2">
          <Label className="text-gray-800">訂購數量 (公斤) *</Label>
          <Input
            type="number"
            step="0.01"
            min="0"
            value={item.ordered_quantity}
            onChange={(e) => updateItem(index, 'ordered_quantity', parseFloat(e.target.value) || 0)}
            className="border-gray-300 text-gray-900 focus:border-blue-500 focus:ring-blue-500"
          />
        </div>

        <div className="space-y-2">
          <Label className="text-gray-800">單價 *</Label>
          <Input
            type="number"
            step="0.01"
            min="0"
            value={item.unit_price}
            onChange={(e) => updateItem(index, 'unit_price', parseFloat(e.target.value) || 0)}
            className="border-gray-300 text-gray-900 focus:border-blue-500 focus:ring-blue-500"
          />
        </div>
      </div>

      <div className="text-sm text-gray-600">
        小計: ${(item.ordered_quantity * item.unit_price).toFixed(2)}
      </div>
    </div>
  );
};
