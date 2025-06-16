
export interface OrderProduct {
  id: string;
  quantity: number;
  products_new: {
    id: string;
    name: string;
    color: string | null;
    color_code: string | null;
  };
  orders: {
    id: string;
    order_number: string;
  };
}

export interface InventoryInfo {
  product_id: string;
  total_stock: number;
  a_grade_stock: number;
  b_grade_stock: number;
  c_grade_stock: number;
  d_grade_stock: number;
  defective_stock: number;
}

export interface PurchaseItem {
  product_id: string;
  ordered_quantity: number;
  unit_price: number;
  specifications?: string;
  selected_product_name?: string;
}
