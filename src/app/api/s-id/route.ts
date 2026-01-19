import { auth, currentUser } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const { userId } = await auth();
  const user = await currentUser();

  if (!userId || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const codeId = searchParams.get('codeId');
  const sId = searchParams.get('sId');

  return NextResponse.json({
    status: 'not_implemented',
    message: 'S-ID endpoint placeholder for future work',
    codeId,
    sId
    // TODO: Look up and return structured S-ID data once defined.
  });
}
