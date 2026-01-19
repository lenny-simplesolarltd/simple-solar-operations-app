import { createSupabaseServerClient } from '@/lib/supabaseServer';
import { getUserRole } from '@/lib/userRoles';
import { auth, currentUser } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';

/**
 * Request body shape for QR scan
 */
type ScanRequest = {
  rawPayload: string; // full text from QR scanner
  size?: string; // optional, e.g. 'S', 'M', 'L'
  systemAcronym?: string; // optional, default "TMGS"
  clientId?: string; // required, attach scan to client (Clerk user id)
  statusPrimary?: string | null; // inventory status primary
  statusSecondary?: string | null; // inventory status secondary
  quantity?: number; // optional quantity override
};

/**
 * Extract code ID from various QR payload formats:
 * 1. Plain code: A6F3HW7L
 * 2. URL path: https://app.example.com/s/B7G4JX9M
 * 3. URL query param: https://app.example.com?code=C8H5KY0N
 * 4. Any other format: Generate a hash-based code ID
 *
 * Never returns null - always generates a valid code ID.
 */
function extractCodeId(raw: string): string {
  const trimmed = raw.trim();

  // Try to parse as URL first
  try {
    const url = new URL(trimmed);

    // 1) Check for ?code=XYZ query parameter
    const codeParam = url.searchParams.get('code');
    if (codeParam && isValidCodeId(codeParam)) {
      return codeParam.toUpperCase();
    }

    // 2) Check last path segment (e.g., /s/B7G4JX9M -> B7G4JX9M)
    const pathSegments = url.pathname.split('/').filter(Boolean);
    if (pathSegments.length > 0) {
      const lastSegment = pathSegments[pathSegments.length - 1];
      if (isValidCodeId(lastSegment)) {
        return lastSegment.toUpperCase();
      }
    }
  } catch {
    // Not a valid URL, continue to plain text check
  }

  // 3) Try as plain code ID
  if (isValidCodeId(trimmed)) {
    return trimmed.toUpperCase();
  }

  // 4) Fallback: Generate a hash-based code ID from the payload
  // This ensures ANY QR code can be tracked
  return generateCodeIdFromPayload(trimmed);
}

/**
 * Check if a string looks like a valid code ID:
 * - 6-12 characters (alphanumeric)
 * - Only uppercase letters and numbers
 */
function isValidCodeId(str: string): boolean {
  const normalized = str.toUpperCase();
  return /^[A-Z0-9]{6,12}$/.test(normalized);
}

/**
 * Generate a deterministic code ID from any payload string.
 * Uses a simple hash function to create a consistent 8-character code.
 */
function generateCodeIdFromPayload(payload: string): string {
  // Simple hash function
  let hash = 0;
  for (let i = 0; i < payload.length; i++) {
    const char = payload.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }

  // Convert to positive number and then to base36 (0-9, A-Z)
  const hashStr = Math.abs(hash).toString(36).toUpperCase();

  // Pad or truncate to 8 characters
  const codeId = (hashStr + '00000000').substring(0, 8);

  return codeId;
}

/**
 * POST /api/qr/scan
 *
 * Persists a QR code scan to the database.
 * Requires Clerk authentication.
 */
export async function POST(request: NextRequest) {
  try {
    // 1. Authenticate with Clerk
    const { userId } = await auth();
    const user = await currentUser();

    if (!userId || !user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized - please sign in' },
        { status: 401 }
      );
    }

    const { role } = await getUserRole(user);

    if (role !== 'company') {
      return NextResponse.json(
        { success: false, error: 'Forbidden - company access required' },
        { status: 403 }
      );
    }

    // 2. Parse request body
    let body: ScanRequest;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid JSON body' },
        { status: 400 }
      );
    }

    // 3. Validate rawPayload exists
    if (!body.rawPayload || typeof body.rawPayload !== 'string') {
      return NextResponse.json(
        {
          success: false,
          error: 'Missing required field: rawPayload (string)'
        },
        { status: 400 }
      );
    }

    // 4. Extract code ID from payload (always succeeds - generates hash if needed)
    const codeId = extractCodeId(body.rawPayload);

    // 5. Prepare code attributes
    const systemAcronym = body.systemAcronym || 'TMGS';
    const size = body.size || 'unspecified';
    const year = new Date().getFullYear();
    const requestedClientId = body.clientId;
    const statusPrimary =
      typeof body.statusPrimary === 'string' && body.statusPrimary.trim()
        ? body.statusPrimary.trim()
        : null;
    const statusSecondary =
      typeof body.statusSecondary === 'string' && body.statusSecondary.trim()
        ? body.statusSecondary.trim()
        : null;
    const quantity =
      typeof body.quantity === 'number' && Number.isFinite(body.quantity)
        ? Math.max(1, Math.floor(body.quantity))
        : 1;

    if (!requestedClientId || typeof requestedClientId !== 'string') {
      return NextResponse.json(
        {
          success: false,
          error: 'Missing required field: clientId (string)'
        },
        { status: 400 }
      );
    }

    // 6. Connect to Supabase with service role
    const supabase = createSupabaseServerClient();

    // 7. Upsert code record
    // Check if code already exists for this user
    const { data: existingCode, error: fetchError } = await supabase
      .from('codes')
      .select('*')
      .eq('id', codeId)
      .single();

    let codeRecord;

    if (fetchError && fetchError.code !== 'PGRST116') {
      // PGRST116 = not found, which is fine
      console.error('Error fetching code:', fetchError);
      return NextResponse.json(
        {
          success: false,
          error: 'Database error while checking for existing code'
        },
        { status: 500 }
      );
    }

    if (existingCode) {
      // Code already exists - keep it and attach client if needed
      if (
        existingCode.owner_user_id &&
        existingCode.owner_user_id !== requestedClientId &&
        existingCode.owner_user_id !== userId
      ) {
        return NextResponse.json(
          {
            success: false,
            error: 'Code is already assigned to a different client'
          },
          { status: 409 }
        );
      }

      const { data: updatedCode, error: updateError } = await supabase
        .from('codes')
        .update({
          owner_user_id: requestedClientId,
          system_acronym: systemAcronym,
          size,
          status_primary: statusPrimary,
          status_secondary: statusSecondary,
          quantity
        })
        .eq('id', codeId)
        .select()
        .single();

      if (updateError) {
        console.error('Error updating code record:', updateError);
        return NextResponse.json(
          { success: false, error: 'Failed to update code record' },
          { status: 500 }
        );
      }

      codeRecord = updatedCode;
    } else {
      // Code doesn't exist - insert new one
      const { data: newCode, error: insertError } = await supabase
        .from('codes')
        .insert({
          id: codeId,
          system_acronym: systemAcronym,
          size: size,
          year: year,
          owner_user_id: requestedClientId,
          status: 'pending',
          status_primary: statusPrimary,
          status_secondary: statusSecondary,
          quantity
        })
        .select()
        .single();

      if (insertError) {
        console.error('Error inserting code:', insertError);
        return NextResponse.json(
          {
            success: false,
            error: 'Database error while creating code record'
          },
          { status: 500 }
        );
      }

      codeRecord = newCode;
    }

    // 8. Insert scan event
    const { data: scanEvent, error: scanError } = await supabase
      .from('scan_events')
      .insert({
        code_id: codeId,
        scanned_by_user_id: userId,
        raw_payload: body.rawPayload,
        status: codeRecord.status || 'pending'
      })
      .select('id, scanned_at, status')
      .single();

    if (scanError) {
      console.error('Error inserting scan event:', scanError);
      return NextResponse.json(
        {
          success: false,
          error: 'Database error while recording scan event'
        },
        { status: 500 }
      );
    }

    // TODO: record a ledger entry for activation once ledger logic is wired.

    // 9. Return success response
    return NextResponse.json({
      success: true,
      code: {
      id: codeRecord.id,
      system_acronym: codeRecord.system_acronym,
      size: codeRecord.size,
      year: codeRecord.year,
      status: codeRecord.status || 'pending',
      status_primary: codeRecord.status_primary ?? null,
      status_secondary: codeRecord.status_secondary ?? null,
      quantity: codeRecord.quantity ?? 1,
      owner_user_id: codeRecord.owner_user_id
    },
      scanEvent: {
        id: scanEvent.id,
        scanned_at: scanEvent.scanned_at,
        status: scanEvent.status || codeRecord.status || 'pending'
      }
    });
  } catch (error) {
    console.error('Unexpected error in POST /api/qr/scan:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error'
      },
      { status: 500 }
    );
  }
}
