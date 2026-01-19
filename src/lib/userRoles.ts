import type { User } from '@clerk/nextjs/server';
import { createSupabaseServerClient } from './supabaseServer';

export type UserRole = 'company' | 'client';
export type SubscriptionPlan = 'basic' | 'pro';

export interface ClientContext {
  clientId: string;
  name: string;
  email?: string | null;
  subscription_plan: SubscriptionPlan;
}

function resolveRoleFromMetadata(user: User | null): UserRole {
  const rawRole = user?.publicMetadata?.role;
  const normalized =
    typeof rawRole === 'string' ? rawRole.trim().toLowerCase() : '';
  // Company accounts should set publicMetadata.role = "company" in Clerk.
  return normalized === 'company' ? 'company' : 'client';
}

/**
 * Looks up the client record for the given Clerk user id.
 * Returns null when no client row exists yet.
 */
export async function getClientContextForUser(
  userId: string
): Promise<ClientContext | null> {
  if (!userId) return null;

  const supabase = createSupabaseServerClient();

  const { data, error } = await supabase
    .from('clients')
    .select('id, name, email, subscription_plan')
    .eq('id', userId)
    .single();

  if (error) {
    // PGRST116 = row not found, which simply means no mapping yet.
    if (error.code !== 'PGRST116') {
      console.error('Failed to fetch client context for user', userId, error);
    }
    return null;
  }

  return {
    clientId: data.id,
    name: data.name,
    email: data.email,
    subscription_plan: (data.subscription_plan || 'basic') as SubscriptionPlan
  };
}

/**
 * Ensures a client row exists for the user (id = Clerk user id).
 */
export async function ensureClientRecord(
  user: User
): Promise<ClientContext | null> {
  const userId = user.id;
  const emailAddress =
    user.primaryEmailAddress?.emailAddress ||
    user.emailAddresses[0]?.emailAddress ||
    null;
  const name =
    user.fullName ||
    [user.firstName, user.lastName].filter(Boolean).join(' ') ||
    user.username ||
    emailAddress ||
    'Unnamed Client';

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from('clients')
    .select('id, name, email, subscription_plan')
    .eq('id', userId)
    .single();

  if (error) {
    if (error.code !== 'PGRST116') {
      console.error('Failed to fetch client row for user', userId, error);
      return null;
    }

    const { data: inserted, error: insertError } = await supabase
      .from('clients')
      .insert({
        id: userId,
        name,
        email: emailAddress,
        subscription_plan: 'basic'
      })
      .select('id, name, email, subscription_plan')
      .single();

    if (insertError) {
      console.error('Failed to create client row for user', userId, insertError);
      return null;
    }

    return {
      clientId: inserted.id,
      name: inserted.name,
      email: inserted.email,
      subscription_plan: (inserted.subscription_plan || 'basic') as SubscriptionPlan
    };
  }

  if (!data) {
    return null;
  }

  const updates: { name?: string; email?: string | null } = {};
  if (!data.name && name) updates.name = name;
  if (!data.email && emailAddress) updates.email = emailAddress;

  if (Object.keys(updates).length > 0) {
    const { data: updated, error: updateError } = await supabase
      .from('clients')
      .update(updates)
      .eq('id', userId)
      .select('id, name, email, subscription_plan')
      .single();

    if (updateError) {
      console.error('Failed to update client row for user', userId, updateError);
    } else if (updated) {
      return {
        clientId: updated.id,
        name: updated.name,
        email: updated.email,
        subscription_plan: (updated.subscription_plan || 'basic') as SubscriptionPlan
      };
    }
  }

  return {
    clientId: data.id,
    name: data.name,
    email: data.email,
    subscription_plan: (data.subscription_plan || 'basic') as SubscriptionPlan
  };
}

/**
 * Resolves the user's role and any associated client context.
 */
export async function getUserRole(
  user: User | null
): Promise<{ role: UserRole; client?: ClientContext }> {
  const role = resolveRoleFromMetadata(user);

  if (role === 'company') {
    return { role };
  }

  if (user) {
    const client = await ensureClientRecord(user);
    if (client) {
      return { role, client };
    }
  }

  return { role };
}
