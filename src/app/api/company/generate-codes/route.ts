import { createSupabaseServerClient } from '@/lib/supabaseServer';
import { getUserRole } from '@/lib/userRoles';
import { auth, currentUser } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { randomInt } from 'crypto';

type GenerateCodesRequest = {
  count: number;
  size?: string;
  system_acronym?: string;
};

const CODE_LENGTH = 8;
const CODE_CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const MAX_RETRIES = 5;

function generateCodeId(existing: Set<string>) {
  let id = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    id += CODE_CHARSET[randomInt(0, CODE_CHARSET.length)];
  }
  if (existing.has(id)) {
    return generateCodeId(existing);
  }
  return id;
}

function getBaseUrl() {
  const envUrl = process.env.NEXT_PUBLIC_APP_URL;
  const fallback = 'http://localhost:3000';
  const raw = envUrl && envUrl.trim().length > 0 ? envUrl.trim() : fallback;
  return raw.replace(/\/+$/, '');
}

export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth();
    const user = await currentUser();

    if (!userId || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { role } = await getUserRole(user);

    if (role !== 'company') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const payload = (await request.json()) as GenerateCodesRequest;
    const count = Number(payload?.count);

    if (!Number.isInteger(count) || count < 1 || count > 200) {
      return NextResponse.json({ error: 'Invalid count' }, { status: 400 });
    }

    const size =
      typeof payload?.size === 'string' && payload.size.trim().length > 0
        ? payload.size.trim()
        : 'unspecified';
    const systemAcronym =
      typeof payload?.system_acronym === 'string' &&
      payload.system_acronym.trim().length > 0
        ? payload.system_acronym.trim()
        : 'TMGS';
    const year = new Date().getFullYear();
    const baseUrl = getBaseUrl();

    const supabase = createSupabaseServerClient();
    const generated = new Set<string>();
    const codes: Array<{
      id: string;
      system_acronym: string;
      size: string;
      year: number;
      url: string;
    }> = [];

    for (let i = 0; i < count; i += 1) {
      let saved = false;
      let attempts = 0;

      while (!saved && attempts < MAX_RETRIES) {
        const id = generateCodeId(generated);
        const { error } = await supabase.from('codes').insert({
          id,
          system_acronym: systemAcronym,
          size,
          year
        });

        if (!error) {
          generated.add(id);
          codes.push({
            id,
            system_acronym: systemAcronym,
            size,
            year,
            url: `${baseUrl}/code/${id}`
          });
          saved = true;
          break;
        }

        const errorCode = (error as { code?: string }).code;
        if (errorCode === '23505') {
          attempts += 1;
          continue;
        }

        console.error('Failed to insert code', error);
        return NextResponse.json(
          { error: 'Failed to generate codes' },
          { status: 500 }
        );
      }

      if (!saved) {
        console.error('Failed to generate unique code ID');
        return NextResponse.json(
          { error: 'Failed to generate codes' },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({ codes });
  } catch (error) {
    console.error('Failed to generate codes', error);
    return NextResponse.json(
      { error: 'Failed to generate codes' },
      { status: 500 }
    );
  }
}
