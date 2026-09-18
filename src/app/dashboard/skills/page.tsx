import { EmptyState } from '@/components/empty-state';
import PageContainer from '@/components/layout/page-container';
import { ReadFailureState } from '@/components/read-failure';
import { Badge } from '@/components/ui/badge';
import { Heading } from '@/components/ui/heading';
import { AssistantPageContext } from '@/features/assistant/components/page-context';
import { formatDate } from '@/features/jobs/format';
import {
  SetSkill,
  SetTeamMember,
  UpsertTeam
} from '@/features/planner/components/resourcing-actions';
import type { InstallerSkillsRead, TeamsRead } from '@/features/planner/types';
import { getCurrentUser } from '@/lib/auth';
import { readOps } from '@/lib/backend/read';
import { isOfficeManager } from '@/lib/roles';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: 'Installer skills | Simple Solar Operations'
};

export default async function SkillsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/sign-in');
  const [skills, teams] = await Promise.all([
    readOps<InstallerSkillsRead>('INSTALLER_SKILLS'),
    readOps<TeamsRead>('RP_TEAMS')
  ]);
  const canEdit = isOfficeManager(user);

  return (
    <PageContainer>
      <AssistantPageContext
        page={{ kind: 'operations', surface: 'installer-skills' }}
      />
      <div className='flex w-full flex-col gap-6'>
        <Heading
          title='Installer skills'
          description='What each installer is qualified for, their daily capacity and their teams. The planner uses these to say who is free and able.'
        />
        {!skills.ok ? (
          <ReadFailureState failure={skills.error} />
        ) : skills.data.installers.length === 0 ? (
          <EmptyState
            title='No active installers'
            description='Give someone the Installer role in People & access first.'
          />
        ) : (
          <ul className='grid gap-3 md:grid-cols-2 xl:grid-cols-3'>
            {skills.data.installers.map((i) => (
              <li
                key={i.person_id}
                className='bg-card flex flex-col gap-2 rounded-lg border p-3 text-sm'
              >
                <div className='flex items-start justify-between gap-2'>
                  <span className='font-semibold'>{i.display_name}</span>
                  <span
                    className={
                      i.capacity_per_day
                        ? 'text-muted-foreground text-xs'
                        : 'text-destructive text-xs'
                    }
                  >
                    {i.capacity_per_day
                      ? `${i.capacity_per_day} job${i.capacity_per_day === 1 ? '' : 's'} a day`
                      : 'No capacity set'}
                  </span>
                </div>
                <div className='flex flex-wrap gap-1'>
                  {i.skills.length === 0 && (
                    <span className='text-muted-foreground text-xs'>
                      No skills recorded
                    </span>
                  )}
                  {i.skills.map((s) =>
                    canEdit ? (
                      <SetSkill
                        key={s.id}
                        installer={i}
                        skills={skills.data.skills}
                        skill={s}
                      />
                    ) : (
                      <Badge
                        key={s.id}
                        variant={
                          s.expired || !s.active ? 'danger' : 'secondary'
                        }
                      >
                        {s.skill}: {s.level}
                      </Badge>
                    )
                  )}
                  {canEdit && (
                    <SetSkill installer={i} skills={skills.data.skills} />
                  )}
                </div>
                {i.skills
                  .filter((s) => s.certified_until)
                  .map((s) => (
                    <span
                      key={s.id}
                      className={
                        s.expired
                          ? 'text-destructive text-xs'
                          : 'text-muted-foreground text-xs'
                      }
                    >
                      {s.skill} certified until {formatDate(s.certified_until!)}
                      {s.expired && ' (expired)'}
                    </span>
                  ))}
                {i.teams.length > 0 && (
                  <span className='text-muted-foreground text-xs'>
                    {i.teams.map((t) => `${t.team} (${t.role})`).join(', ')}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}

        <section className='flex flex-col gap-3'>
          <div className='flex items-center justify-between gap-2'>
            <h2 className='text-lg font-semibold'>Teams</h2>
            {canEdit && <UpsertTeam />}
          </div>
          {!teams.ok ? (
            <ReadFailureState failure={teams.error} />
          ) : teams.data.teams.length === 0 ? (
            <p className='text-muted-foreground text-sm'>No teams yet.</p>
          ) : (
            <ul className='grid gap-3 md:grid-cols-2 xl:grid-cols-3'>
              {teams.data.teams.map((t) => (
                <li
                  key={t.team_id}
                  className='bg-card flex flex-col gap-2 rounded-lg border p-3 text-sm'
                >
                  <div className='flex items-center justify-between gap-2'>
                    <span className='font-semibold'>
                      {t.name}{' '}
                      <span className='text-muted-foreground font-normal'>
                        · {t.trade}
                      </span>
                    </span>
                    {!t.active && <Badge variant='outline'>Inactive</Badge>}
                  </div>
                  <ul className='text-muted-foreground text-xs'>
                    {t.members.length === 0 && <li>No members</li>}
                    {t.members.map((m) => (
                      <li key={m.person_id}>
                        {m.display_name} · {m.role}
                      </li>
                    ))}
                  </ul>
                  {canEdit && skills.ok && (
                    <div className='flex flex-wrap gap-1'>
                      <UpsertTeam team={t} />
                      <SetTeamMember
                        team={t}
                        installers={skills.data.installers}
                      />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </PageContainer>
  );
}
