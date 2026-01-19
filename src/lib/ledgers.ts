import { createSupabaseServerClient } from './supabaseServer';

export const BASE_LEDGER_NAMES = [
  'Master',
  'Asset/Inventory',
  'Green',
  'Labor',
  'Operational',
  'Economical'
] as const;

export type LedgerName = (typeof BASE_LEDGER_NAMES)[number];

export async function seedBaseLedgers() {
  const supabase = createSupabaseServerClient();
  const rows = BASE_LEDGER_NAMES.map((name) => ({ name }));

  return supabase
    .from('ledgers')
    .upsert(rows, { onConflict: 'name', ignoreDuplicates: true })
    .select('id, name');
}

export type LedgerEntryPayload = {
  ledger_id: string;
  code_id?: string | null;
  client_id?: string | null;
  amount?: number | null;
  metadata?: Record<string, unknown> | null;
};

export function buildLedgerEntryPayload(
  input: LedgerEntryPayload
): LedgerEntryPayload {
  // TODO: expand with validation + defaults when ledger events are defined.
  return input;
}
