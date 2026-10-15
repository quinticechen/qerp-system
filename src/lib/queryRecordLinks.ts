import { OPEN_RECORD_PARAM, OPEN_TAB_PARAM } from '@/hooks/useOpenRecordFromUrl';

interface RecordPage {
  path: string;
  /** Tab to show first. */
  tab?: string;
  /** false: the page has no dialog for this record (e.g. a single roll). */
  opens: boolean;
}

const page = (path: string, tab?: string, opens = true): RecordPage => ({ path, tab, opens });

/** The page of each write tool's record (docs/requirements/QUERY_UI_LAYOUT_AND_RECORD_NAV.md §1.2). */
const RECORD_PAGES: Record<string, RecordPage> = {
  create_customer: page('/customer'), update_customer: page('/customer'), set_customer_active: page('/customer'),
  create_factory: page('/factory'), update_factory: page('/factory'), set_factory_active: page('/factory'),
  create_order: page('/order'), update_order_status: page('/order'), update_order: page('/order'), cancel_order: page('/order'),
  create_purchase_order: page('/purchase'), update_purchase_order: page('/purchase'), cancel_purchase_order: page('/purchase'),
  receive_inventory: page('/inventory', 'records'), update_inventory: page('/inventory', 'records'),
  update_inventory_roll: page('/inventory', undefined, false),
  create_shipping: page('/shipping'), update_shipping: page('/shipping'), cancel_shipping: page('/shipping'),
  create_product: page('/product'), update_product: page('/product'), set_product_active: page('/product'),
  add_product_color: page('/product'), update_product_color: page('/product'), set_product_color_active: page('/product'),
  create_shelf: page('/shelf'), update_shelf: page('/shelf'), set_shelf_active: page('/shelf'),
};

/** Where to go after a Query action was confirmed: the record's page, opening it; null for unknown tools. */
export function recordLink(tool: string, recordId: string | null | undefined): string | null {
  const target = RECORD_PAGES[tool];
  if (!target) return null;
  const params = new URLSearchParams();
  if (target.tab) params.set(OPEN_TAB_PARAM, target.tab);
  if (target.opens && recordId) params.set(OPEN_RECORD_PARAM, recordId);
  const query = params.toString();
  return query ? `${target.path}?${query}` : target.path;
}
