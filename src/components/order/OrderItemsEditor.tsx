import React from 'react';
import { LineItemLock, ProductLineItemsEditor } from '@/components/common/ProductLineItemsEditor';
import { EditableOrderItem, newOrderItem } from '@/hooks/useOrderItems';
import { ProductOption } from '@/hooks/useProductOptions';

interface OrderItemsEditorProps {
  items: EditableOrderItem[];
  onChange: (items: EditableOrderItem[]) => void;
  products: ProductOption[];
  // Products already on a purchase order for this order; their lines cannot be removed or switched
  purchasedProductIds: Set<string>;
}

export const OrderItemsEditor = ({ items, onChange, products, purchasedProductIds }: OrderItemsEditorProps) => {
  const getLock = (item: EditableOrderItem): LineItemLock => {
    const reasons: string[] = [];
    if (item.shipped_quantity > 0) reasons.push(`已出貨 ${item.shipped_quantity} 公斤`);
    if (item.id && purchasedProductIds.has(item.product_id)) reasons.push('已採購');
    return { reasons, minQuantity: item.shipped_quantity };
  };

  return (
    <ProductLineItemsEditor
      items={items}
      onChange={onChange}
      products={products}
      createItem={newOrderItem}
      getLock={getLock}
      quantityLabel="數量（公斤）"
      totalLabel="訂單總額"
    />
  );
};
