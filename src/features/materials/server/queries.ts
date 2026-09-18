import 'server-only';

import { createDataClient } from '@/lib/supabase/data';

// Reference data for material forms (products and merchants are readable by
// every active staff member under RLS). Failures degrade to empty pick lists.

export async function getProductOptions(stockTrackedOnly = false) {
  const supabase = await createDataClient();
  let query = supabase
    .from('products')
    .select('id, name, sku')
    .eq('active', true)
    .order('name');
  if (stockTrackedOnly) query = query.eq('stock_tracked', true);
  const { data, error } = await query;
  return error || !data ? [] : data;
}

export async function getMerchantOptions() {
  const supabase = await createDataClient();
  const { data, error } = await supabase
    .from('companies')
    .select('id, name')
    .eq('active', true)
    .eq('type', 'Merchant')
    .order('name');
  return error || !data ? [] : data;
}
