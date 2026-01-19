import { createClient } from '@supabase/supabase-js';
import type { CodeStatus } from '@/constants/statuses';

/**
 * Server-side Supabase client with service role key.
 *
 * IMPORTANT: This should ONLY be used in API routes and server components.
 * Never expose this client to the browser.
 *
 * The service role key bypasses Row Level Security (RLS), so we manually
 * enforce data isolation using Clerk's userId in our queries.
 *
 * Authentication is handled by Clerk, and we use the Clerk userId to
 * populate owner_user_id and scanned_by_user_id fields.
 */
export function getSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error(
      'Missing Supabase environment variables. Please set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your .env.local file.'
    );
  }

  return createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}

/**
 * Database types (matches Supabase schema)
 */
export interface CodeRecord {
  id: string; // Alphanumeric code ID (e.g., "A6F3HW7L")
  system_acronym: string; // System name (default: "TMGS")
  size: string; // Size label (e.g., "S", "M", "L", "unspecified")
  year: number; // Year code was created
  owner_user_id: string; // Clerk user ID of the owning client
  created_at: string; // ISO timestamp
  status?: CodeStatus; // pending | in_progress | completed | archived
  status_primary?: string | null; // Inventory status (primary)
  status_secondary?: string | null; // Inventory status (secondary)
  quantity: number; // Inventory quantity
  notes?: string | null; // Client notes/description
  client_id?: string | null; // Legacy client assignment (deprecated)
}

export interface ScanEventRecord {
  id: string; // UUID
  code_id: string; // References codes.id
  scanned_by_user_id: string; // Clerk user ID
  scanned_at: string; // ISO timestamp
  raw_payload: string; // Full QR code text
  status?: CodeStatus | null; // Status snapshot at scan time
}

export interface ScanEventWithCode extends ScanEventRecord {
  code?: CodeRecord; // Joined code data
}
