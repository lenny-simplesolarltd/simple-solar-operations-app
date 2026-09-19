// Read-model shapes for materials, merchant orders, goods in and stock. They
// mirror app.read_* in the R2 and view-port migrations. Client-safe.

export interface MaterialsBoardRow {
  job_id: string;
  job_ref: string;
  workflow_stage: string;
  customer_name: string | null;
  postcode: string | null;
  lines: number;
  to_order: number;
  drafted: number;
  awaiting_confirmation: number;
  confirmed: number;
  received: number;
  part_received: number;
  from_stock: number;
  external: number;
  at_risk: number;
  next_need_by: string | null;
  install_date: string | null;
}

export interface MaterialsBoardRead {
  view: 'action' | 'all';
  total: number;
  count: number;
  truncated: boolean;
  jobs: MaterialsBoardRow[];
}

export type MaterialState =
  | 'Stock'
  | 'VerifyExternalOrder'
  | 'ToOrder'
  | 'Received'
  | 'PartReceived'
  | 'Confirmed'
  | 'AwaitingConfirmation'
  | 'Drafted';

export interface MaterialItem {
  material_id: string;
  product_id: string | null;
  product_name: string | null;
  description: string | null;
  quantity: number;
  unit: string | null;
  source: 'ToOrder' | 'AlreadyOrdered' | 'Stock';
  work_type: string;
  merchant_id: string | null;
  merchant: string | null;
  need_by_date: string | null;
  order_id: string | null;
  order_status: string | null;
  received_good: number;
  received_damaged: number;
  state: MaterialState;
  lead_time_risk: {
    latest_order_date: string;
    lead_days: number;
    at_risk: boolean;
  } | null;
}

export interface MaterialRequirementsRead {
  found: boolean;
  job_id: string;
  count: number;
  to_order: number;
  items: MaterialItem[];
}

export interface OrderRow {
  id: string;
  version: number;
  status: string;
  revision: number;
  confirmed_revision: number | null;
  work_type: string;
  supplier_reference: string | null;
  requested_delivery_date: string | null;
  created_at: string;
  acknowledgement_required: boolean;
  job_id: string | null;
  job_ref: string | null;
  customer_name: string | null;
  postcode: string | null;
  merchant_id: string | null;
  merchant: string | null;
  line_count: number;
  outstanding: number;
  next_delivery: {
    id: string;
    expected_date: string | null;
    receipt_status: string | null;
  } | null;
}

export interface OrdersListRead {
  counts: Record<string, number>;
  total: number;
  count: number;
  truncated: boolean;
  merchants: { id: string; name: string }[];
  orders: OrderRow[];
}

export interface OrderLine {
  id: string;
  material_id: string | null;
  product_id: string | null;
  description: string | null;
  quantity: number;
  cancelled_quantity: number;
  unit: string | null;
  received_good: number;
  received_damaged: number;
  outstanding: number;
}

export interface OrderViewRead {
  found: boolean;
  order: {
    id: string;
    job_id: string;
    merchant_id: string;
    work_type: string;
    status: string;
    revision: number;
    confirmed_revision: number | null;
    supplier_reference: string | null;
    requested_delivery_date: string | null;
    version: number;
    created_at: string;
  };
  job: {
    id: string;
    job_reference: string;
    display_name: string | null;
  } | null;
  merchant: {
    id: string;
    name: string;
    standard_lead_days: number | null;
    delivery_weekday: number | null;
    contacts: {
      contact_id: string;
      name: string;
      email: string;
      channel: string;
    }[];
  } | null;
  acknowledgement_required: boolean;
  lines: OrderLine[];
  deliveries: {
    id: string;
    expected_date: string | null;
    actual_received_at: string | null;
    receipt_status: string | null;
    delivery_note_reference: string | null;
    discrepancy_note: string | null;
  }[];
  communications: {
    id: string;
    type: string;
    revision: number | null;
    status: string;
    subject: string | null;
  }[];
  acknowledgements: {
    id: string;
    acknowledged_revision: number;
    response: string;
    response_text: string | null;
    received_at: string | null;
  }[];
  tasks: {
    id: string;
    template_code: string;
    title: string;
    status: string;
    due_at: string | null;
  }[];
  issues: { id: string; category: string; status: string }[];
}

export interface StoreQueueRead {
  from: string;
  to: string;
  expected_deliveries: {
    delivery_id: string;
    order_id: string;
    expected_date: string | null;
    merchant: string | null;
    work_type: string | null;
    job_id: string | null;
    order_status: string;
    supplier_reference: string | null;
  }[];
  open_store_tasks: {
    task_id: string;
    template_code: string;
    title: string;
    due_at: string | null;
    related_entity_id: string | null;
    job_id: string | null;
  }[];
}

export interface GoodsInDetailRead {
  job_id: string;
  job_ref: string;
  job_label: string | null;
  delivery_id: string;
  order_id: string;
  expected_version: number;
  order_status: string;
  receipt_status: string | null;
  expected_date: string | null;
  lines: OrderLine[];
}

export interface StockProductRow {
  product_id: string;
  sku: string;
  name: string;
  category: string | null;
  unit: string;
  version: number;
  store_balance: number;
  quarantine_balance: number;
  reserved: number;
  available: number;
  has_opening: boolean;
}

export interface StocktakeRow {
  id: string;
  status: 'Draft' | 'Review' | 'Approved';
  location: string | null;
  cut_off_at: string;
  lines: number;
  counted: number;
  variances: number;
  items: {
    product_id: string;
    name: string;
    sku: string;
    unit: string;
    expected: number;
    counted: number | null;
    variance: number | null;
    reason: string | null;
  }[];
}

export interface StockOverviewRead {
  configured: boolean;
  message?: string;
  products: StockProductRow[];
  stocktakes: StocktakeRow[];
}

export interface StockPickingRead {
  job_id: string;
  job_ref: string;
  summary: 'NoAction' | 'Blocked' | 'Ready';
  items: {
    material_id: string;
    product_id: string | null;
    product_name: string | null;
    required: number;
    reserved: number;
    picked: number;
    reservation_id: string | null;
    reservation_version: number | null;
    issued: number;
    outstanding: number;
    available: number | null;
    ready: boolean;
    issues: string[];
  }[];
}
