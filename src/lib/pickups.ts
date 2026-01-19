import { createSupabaseServerClient } from './supabaseServer';

export type PickupStatus =
  | 'scheduled'
  | 'completed'
  | 'missed'
  | 'delayed'
  | string;

export type PickupRecord = {
  id: string;
  client_id: string;
  scheduled_at?: string | null;
  completed_at?: string | null;
  status: PickupStatus;
  quantity_collected: number;
  created_at: string;
};

type PickupCreateInput = {
  clientId: string;
  scheduledAt?: Date | null;
  status?: PickupStatus;
  quantityCollected?: number;
};

export async function createPickup(input: PickupCreateInput) {
  const supabase = createSupabaseServerClient();
  const status = input.status ?? 'scheduled';
  const quantity = Math.max(0, Math.floor(input.quantityCollected ?? 0));

  return supabase
    .from('pickups')
    .insert({
      client_id: input.clientId,
      scheduled_at: input.scheduledAt?.toISOString() ?? null,
      status,
      quantity_collected: quantity
    })
    .select(
      'id, client_id, scheduled_at, completed_at, status, quantity_collected, created_at'
    )
    .single();
}

type PickupCompleteInput = {
  clientId: string;
  quantityCollected: number;
  scheduledAt?: Date | null;
  completedAt?: Date | null;
  status?: PickupStatus;
};

export async function recordPickupCompletion(input: PickupCompleteInput) {
  const supabase = createSupabaseServerClient();
  const completedAt = input.completedAt ?? new Date();
  const scheduledAt = input.scheduledAt ?? null;

  return supabase
    .from('pickups')
    .insert({
      client_id: input.clientId,
      scheduled_at: scheduledAt ? scheduledAt.toISOString() : null,
      completed_at: completedAt.toISOString(),
      status: input.status ?? 'completed',
      quantity_collected: Math.max(0, Math.floor(input.quantityCollected))
    })
    .select(
      'id, client_id, scheduled_at, completed_at, status, quantity_collected, created_at'
    )
    .single();
}
