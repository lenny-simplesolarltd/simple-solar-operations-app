import { CODE_STATUSES, type CodeStatus } from '@/constants/statuses';
import { createSupabaseServerClient } from '@/lib/supabaseServer';
import { getUserRole } from '@/lib/userRoles';
import { auth, currentUser } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';

type Params = {
  codeId: string;
};

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<Params> }
) {
  try {
    const params = await context.params;
    const codeId = params?.codeId;

    if (!codeId) {
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

    const body = await request.json();
    const status: CodeStatus | undefined = body?.status;

    if (!status || !CODE_STATUSES.includes(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    }

    const supabase = createSupabaseServerClient();

    const { data: existingCode, error: fetchError } = await supabase
      .from('codes')
      .select(
        'id, system_acronym, size, year, status, status_primary, status_secondary, quantity, owner_user_id, created_at'
      )
      .eq('id', codeId)
      .single();

    if (fetchError || !existingCode) {
      return NextResponse.json({ error: 'Code not found' }, { status: 404 });
    }

    const { data: updatedCode, error: updateError } = await supabase
      .from('codes')
      .update({ status })
      .eq('id', codeId)
      .select(
        'id, system_acronym, size, year, status, status_primary, status_secondary, quantity, owner_user_id, created_at'
      )
      .single();

    if (updateError) {
      console.error('Failed to update code status', updateError);
      return NextResponse.json(
        { error: 'Failed to update status' },
        { status: 500 }
      );
    }

    // Record a status change event (optional but useful for auditing)
    await supabase.from('scan_events').insert({
      code_id: codeId,
      scanned_by_user_id: userId,
      raw_payload: `STATUS_UPDATE:${status}`,
      status
    });

    // TODO: record a ledger entry for status changes once ledger logic is wired.

    return NextResponse.json({ code: updatedCode });
  } catch (error) {
    console.error('Unexpected error in PATCH /api/codes/:codeId/status', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
