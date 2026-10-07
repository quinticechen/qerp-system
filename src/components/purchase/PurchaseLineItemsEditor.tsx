import React from 'react';
import { LineItemLock, ProductLineItemsEditor } from '@/components/common/ProductLineItemsEditor';
import { EditablePurchaseOrderItem, newPurchaseOrderItem } from '@/hooks/usePurchaseOrderItems';
import { ProductOption } from '@/hooks/useProductOptions';

interface PurchaseLineItemsEditorProps {
  items: EditablePurchaseOrderItem[];
  onChange: (items: EditablePurchaseOrderItem[]) => void;
  products: ProductOption[];
}

const getLock = (item: EditablePurchaseOrderItem): LineItemLock => ({
  reasons: item.received_quantity > 0 ? [`已入庫 ${item.received_quantity} 公斤`] : [],
  minQuantity: item.received_quantity,
});

export const PurchaseLineItemsEditor = ({ items, onChange, products }: PurchaseLineItemsEditorProps) => (
  <ProductLineItemsEditor
    items={items}
    onChange={onChange}
    products={products}
    createItem={newPurchaseOrderItem}
    getLock={getLock}
    quantityLabel="採購數量（公斤）"
    totalLabel="採購總額"
    showRolls
  />
);
