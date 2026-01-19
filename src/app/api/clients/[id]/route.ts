import { createSupabaseServerClient } from '@/lib/supabaseServer';
import { getUserRole, type SubscriptionPlan } from '@/lib/userRoles';
import { auth, currentUser } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';

type Params = {
  id: string;
};

const VALID_PLANS: SubscriptionPlan[] = ['basic', 'pro'];

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<Params> }
) {
  try {
    const params = await context.params;
    const clientId = params?.id;

    if (!clientId) {
      return NextResponse.json({ error: 'Missing client id' }, { status: 400 });
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
    const subscription_plan: SubscriptionPlan | undefined = body?.subscription_plan;

    if (!subscription_plan || !VALID_PLANS.includes(subscription_plan)) {
      return NextResponse.json({ error: 'Invalid subscription plan' }, { status: 400 });
    }

    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase
      .from('clients')
      .update({ subscription_plan })
      .eq('id', clientId)
      .select('id, name, subscription_plan, created_at')
      .single();

    if (error) {
      console.error('Failed to update client plan', error);
      return NextResponse.json(
        { error: 'Failed to update plan' },
        { status: 500 }
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('Unexpected error in PATCH /api/clients/:id', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
