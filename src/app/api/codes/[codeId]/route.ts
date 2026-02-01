import { extractCodeId } from '@/lib/qr';
import { createSupabaseServerClient } from '@/lib/supabaseServer';
import { getUserRole } from '@/lib/userRoles';
import { auth, currentUser } from '@clerk/nextjs/server';
import { CODE_STATUSES, type CodeStatus } from '@/constants/statuses';
import { NextRequest, NextResponse } from 'next/server';

type Params = {
  codeId: string;
};

const SIZE_OPTIONS = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'unspecified'];

export async function GET(
  _request: NextRequest,
  context: { params: Promise<Params> }
) {
  try {
    const params = await context.params;
    const rawCodeId = params?.codeId;

    if (!rawCodeId) {
      return NextResponse.json({ error: 'Missing code id' }, { status: 400 });
    }

    const { userId } = await auth();
    const user = await currentUser();

    if (!userId || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { role } = await getUserRole(user);

    let codeId: string;
    try {
      codeId = extractCodeId(rawCodeId);
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Invalid code id' },
        { status: 400 }
      );
    }

    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase
      .from('codes')
      .select(
        'id, system_acronym, size, year, status, status_primary, status_secondary, quantity, notes, owner_user_id, created_at'
      )
      .eq('id', codeId)
      .single();

    if (error || !data) {
      return NextResponse.json({ error: 'Code not found' }, { status: 404 });
    }

    if (role === 'client' && data.owner_user_id !== userId) {
      return NextResponse.json(
        { error: 'Not allowed to access this code' },
        { status: 403 }
      );
    }

    return NextResponse.json({ code: data });
  } catch (error) {
    console.error('Unexpected error in GET /api/codes/:codeId', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<Params> }
) {
  try {
    const params = await context.params;
    const rawCodeId = params?.codeId;

    if (!rawCodeId) {
      return NextResponse.json({ error: 'Missing code id' }, { status: 400 });
    }

    const { userId } = await auth();
    const user = await currentUser();

    if (!userId || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { role } = await getUserRole(user);

    let codeId: string;
    try {
      codeId = extractCodeId(rawCodeId);
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Invalid code id' },
        { status: 400 }
      );
    }
    const body = await request.json();
    const supabase = createSupabaseServerClient();

    if (role === 'company') {
      const updates: {
        owner_user_id?: string | null;
        size?: string;
        status?: CodeStatus;
      } = {};

      if (body?.owner_user_id === null) {
        updates.owner_user_id = null;
      } else if (typeof body?.owner_user_id === 'string') {
        const trimmed = body.owner_user_id.trim();
        if (!trimmed) {
          updates.owner_user_id = null;
        } else {
          const { data: clientRow, error: clientError } = await supabase
            .from('clients')
            .select('id')
            .eq('id', trimmed)
            .single();

          if (clientError || !clientRow) {
            return NextResponse.json(
              { error: 'Invalid client selection' },
              { status: 400 }
            );
          }

          updates.owner_user_id = trimmed;
        }
      }

      if (typeof body?.size === 'string') {
        const trimmed = body.size.trim();
        const normalized = trimmed ? trimmed.toUpperCase() : 'unspecified';
        const sizeValue =
          normalized === 'UNSPECIFIED' ? 'unspecified' : normalized;

        if (!SIZE_OPTIONS.includes(sizeValue)) {
          return NextResponse.json({ error: 'Invalid size' }, { status: 400 });
        }
        updates.size = sizeValue;
      }

      if (typeof body?.status === 'string') {
        const normalized = body.status.trim();
        if (!CODE_STATUSES.includes(normalized as CodeStatus)) {
          return NextResponse.json(
            { error: 'Invalid status' },
            { status: 400 }
          );
        }
        updates.status = normalized as CodeStatus;
      }

      if (Object.keys(updates).length === 0) {
        return NextResponse.json(
          { error: 'No valid fields to update' },
          { status: 400 }
        );
      }

      const { data: existing, error: fetchError } = await supabase
        .from('codes')
        .select('id')
        .eq('id', codeId)
        .single();

      if (fetchError || !existing) {
        return NextResponse.json({ error: 'Code not found' }, { status: 404 });
      }

      const { data, error } = await supabase
        .from('codes')
        .update(updates)
        .eq('id', codeId)
        .select(
          'id, system_acronym, size, year, status, status_primary, status_secondary, quantity, notes, owner_user_id, created_at'
        )
        .single();

      if (error || !data) {
        console.error('Failed to update code fields', error);
        return NextResponse.json(
          { error: 'Failed to update code' },
          { status: 500 }
        );
      }

      if (updates.status) {
        await supabase.from('scan_events').insert({
          code_id: codeId,
          scanned_by_user_id: userId,
          raw_payload: `STATUS_UPDATE:${updates.status}`,
          status: updates.status
        });
      }

      return NextResponse.json({ code: data });
    }

    if (role !== 'client') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const updates: { notes?: string | null; quantity?: number } = {};

    if (typeof body?.notes === 'string') {
      const trimmed = body.notes.trim();
      updates.notes = trimmed ? trimmed : null;
    } else if (body?.notes === null) {
      updates.notes = null;
    }

    if (typeof body?.quantity === 'number' && Number.isFinite(body.quantity)) {
      updates.quantity = Math.max(1, Math.floor(body.quantity));
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: 'No valid fields to update' },
        { status: 400 }
      );
    }

    const { data: existing, error: fetchError } = await supabase
      .from('codes')
      .select('id, owner_user_id')
      .eq('id', codeId)
      .single();

    if (fetchError || !existing) {
      return NextResponse.json({ error: 'Code not found' }, { status: 404 });
    }

    if (existing.owner_user_id !== userId) {
      return NextResponse.json(
        { error: 'Not allowed to update this code' },
        { status: 403 }
      );
    }

    const { data, error } = await supabase
      .from('codes')
      .update(updates)
      .eq('id', codeId)
      .select(
        'id, system_acronym, size, year, status, status_primary, status_secondary, quantity, notes, owner_user_id, created_at'
      )
      .single();

    if (error || !data) {
      console.error('Failed to update code fields', error);
      return NextResponse.json(
        { error: 'Failed to update code' },
        { status: 500 }
      );
    }

    return NextResponse.json({ code: data });
  } catch (error) {
    console.error('Unexpected error in PATCH /api/codes/:codeId', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<Params> }
) {
  try {
    const params = await context.params;
    const rawCodeId = params?.codeId;

    if (!rawCodeId) {
      return NextResponse.json({ error: 'Missing code id' }, { status: 400 });
    }

    const { userId } = await auth();
    const user = await currentUser();

    if (!userId || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { role } = await getUserRole(user);
    if (role !== 'company') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
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

    const supabase = createSupabaseServerClient();

    const { error: scanError } = await supabase
      .from('scan_events')
      .delete()
      .eq('code_id', codeId);

    if (scanError) {
      console.error('Failed to delete scan events', scanError);
      return NextResponse.json(
        { error: 'Failed to delete code' },
        { status: 500 }
      );
    }

    const { data, error } = await supabase
      .from('codes')
      .delete()
      .eq('id', codeId)
      .select('id')
      .single();

    if (error || !data) {
      if ((error as { code?: string }).code === 'PGRST116') {
        return NextResponse.json({ error: 'Code not found' }, { status: 404 });
      }
      console.error('Failed to delete code', error);
      return NextResponse.json(
        { error: 'Failed to delete code' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Unexpected error in DELETE /api/codes/:codeId', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
