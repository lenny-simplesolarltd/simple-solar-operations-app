import { extractCodeId } from '@/lib/qr';
import { createSupabaseServerClient } from '@/lib/supabaseServer';
import { NextRequest, NextResponse } from 'next/server';

type Params = {
  codeId: string;
};

type PublicScanRequest = {
  rawPayload?: string;
};

export async function POST(
  request: NextRequest,
  context: { params: Promise<Params> }
) {
  try {
    const params = await context.params;
    const rawCodeId = params?.codeId;

    if (!rawCodeId) {
      return NextResponse.json({ error: 'Missing code id' }, { status: 400 });
    }

    let codeId: string;
    try {
      codeId = extractCodeId(rawCodeId);
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Invalid code id' },
        { status: 400 }
      );
    }

    let body: PublicScanRequest = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }

    const rawPayload =
      typeof body.rawPayload === 'string' && body.rawPayload.trim()
        ? body.rawPayload.trim()
        : codeId;

    const supabase = createSupabaseServerClient();
    const { data: code, error: codeError } = await supabase
      .from('codes')
      .select('id, system_acronym, size, year, created_at, status')
      .eq('id', codeId)
      .single();

    if (codeError || !code) {
      return NextResponse.json({ error: 'Code not found' }, { status: 404 });
    }

    const { data: scanEvent, error: scanError } = await supabase
      .from('scan_events')
      .insert({
        code_id: codeId,
        scanned_by_user_id: 'public',
        raw_payload: rawPayload,
        status: code.status || 'pending'
      })
      .select('id, scanned_at')
      .single();

    if (scanError || !scanEvent) {
      console.error('Failed to record public scan', scanError);
      return NextResponse.json(
        { error: 'Failed to record scan' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      code: {
        id: code.id,
        system_acronym: code.system_acronym,
        size: code.size,
        year: code.year,
        created_at: code.created_at
      },
      scanEvent: {
        id: scanEvent.id,
        scanned_at: scanEvent.scanned_at
      }
    });
  } catch (error) {
    console.error('Unexpected error in POST /api/public/codes/:codeId', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
