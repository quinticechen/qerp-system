
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
  console.log(`PurchaseItemForm ${index} - Received item:`, item);
  console.log(`PurchaseItemForm ${index} - selected_product_name:`, item.selected_product_name);

  // Get available color variants for the selected product
  const availableColorVariants = item.selected_product_name 
    ? getColorVariants(item.selected_product_name) 
    : [];

  // Get the selected product details
  const selectedProduct = item.product_id 
    ? products?.find(p => p.id === item.product_id)
    : null;

  console.log(`PurchaseItemForm ${index} - Available color variants:`, availableColorVariants);
  console.log(`PurchaseItemForm ${index} - Selected product:`, selectedProduct);

  const handleProductNameSelect = (productName: string) => {
    console.log(`PurchaseItemForm ${index} - Selecting product name:`, productName);
    
    // Update product name
    updateItem(index, 'selected_product_name', productName);
    
    // Clear product ID when product name changes
    updateItem(index, 'product_id', '');
    
    // Reset other fields
    updateItem(index, 'unit_price', 0);
    updateItem(index, 'ordered_quantity', 0);
    updateItem(index, 'specifications', '');
    
    // Close dropdown
    setProductNameOpen(false);
    
    console.log(`PurchaseItemForm ${index} - Product name selection completed`);
  };

  const handleColorSelect = (productId: string) => {
    console.log(`PurchaseItemForm ${index} - Selecting product ID:`, productId);
    
    // Update the product_id
    updateItem(index, 'product_id', productId);
    
    // Close the dropdown
    setColorOpen(false);
    
    console.log(`PurchaseItemForm ${index} - Color selection completed`);
  };

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
        {/* Product Name Selection */}
        <div className="space-y-2">
          <Label>產品名稱 *</Label>
          <Popover open={productNameOpen} onOpenChange={setProductNameOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                className="w-full justify-between"
              >
                <span className="truncate">
                  {item.selected_product_name || "選擇產品名稱..."}
                </span>
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
              <Command>
                <CommandInput placeholder="搜尋產品名稱..." />
                <CommandList>
                  <CommandEmpty>
                    {uniqueProductNames.length === 0 ? "無產品資料，請先在產品管理中新增產品" : "未找到產品。"}
                  </CommandEmpty>
                  <CommandGroup>
                    {uniqueProductNames.map((name) => (
                      <CommandItem
                        key={name}
                        value={name}
                        onSelect={() => handleProductNameSelect(name)}
                      >
                        <span className="flex-1">{name}</span>
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

        {/* Color/Color Code Selection */}
        <div className="space-y-2">
          <Label>顏色/色碼 *</Label>
          <Popover open={colorOpen} onOpenChange={setColorOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                disabled={!item.selected_product_name || availableColorVariants.length === 0}
                className="w-full justify-between"
              >
                <span className="truncate">
                  {selectedProduct ? (
                    <div className="flex items-center space-x-2">
                      {selectedProduct.color_code && (
                        <div 
                          className="w-4 h-4 rounded border border-gray-400 flex-shrink-0"
                          style={{ backgroundColor: selectedProduct.color_code }}
                        />
                      )}
                      <span>
                        {selectedProduct.color || '無顏色'} 
                        {selectedProduct.color_code ? ` (${selectedProduct.color_code})` : ''}
                      </span>
                    </div>
                  ) : (
                    "選擇顏色..."
                  )}
                </span>
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
              <Command>
                <CommandInput placeholder="搜尋顏色..." />
                <CommandList>
                  <CommandEmpty>未找到顏色。</CommandEmpty>
                  <CommandGroup>
                    {availableColorVariants.map((variant) => (
                      <CommandItem
                        key={variant.id}
                        value={`${variant.color || '無顏色'} ${variant.color_code || ''}`}
                        onSelect={() => handleColorSelect(variant.id)}
                      >
                        <div className="flex items-center space-x-2 flex-1">
                          {variant.color_code && (
                            <div 
                              className="w-4 h-4 rounded border border-gray-400 flex-shrink-0"
                              style={{ backgroundColor: variant.color_code }}
                            />
                          )}
                          <span>
                            {variant.color || '無顏色'} 
                            {variant.color_code ? ` (${variant.color_code})` : ''}
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

        {/* Quantity Input */}
        <div className="space-y-2">
          <Label>訂購數量 (公斤) *</Label>
          <Input
            type="number"
            step="0.01"
            min="0"
            value={item.ordered_quantity || ''}
            onChange={(e) => updateItem(index, 'ordered_quantity', parseFloat(e.target.value) || 0)}
            placeholder="輸入數量"
          />
        </div>

        {/* Unit Price Input */}
        <div className="space-y-2">
          <Label>單價 *</Label>
          <Input
            type="number"
            step="0.01"
            min="0"
            value={item.unit_price || ''}
            onChange={(e) => updateItem(index, 'unit_price', parseFloat(e.target.value) || 0)}
            placeholder="輸入單價"
          />
        </div>
      </div>

      {/* Subtotal Display */}
      {item.ordered_quantity > 0 && item.unit_price > 0 && (
        <div className="text-sm text-gray-600 bg-gray-50 p-3 rounded">
          小計: ${(item.ordered_quantity * item.unit_price).toFixed(2)}
        </div>
      )}
    </div>
  );
};
