import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import type { AppUser } from '@/lib/auth';

interface UserAvatarProfileProps {
  className?: string;
  showInfo?: boolean;
  user: AppUser | null;
}

export function UserAvatarProfile({
  className,
  showInfo = false,
  user
}: UserAvatarProfileProps) {
  const displayName = user?.fullName || user?.email || '';

  return (
    <div className='flex items-center gap-2'>
      <Avatar className={className}>
        <AvatarImage src={user?.imageUrl || ''} alt={displayName} />
        <AvatarFallback className='rounded-lg'>
          {displayName.slice(0, 2).toUpperCase()}
        </AvatarFallback>
      </Avatar>

      {showInfo && (
        <div className='grid flex-1 text-left text-sm leading-tight'>
          <span className='truncate font-semibold'>{displayName}</span>
          <span className='truncate text-xs'>{user?.email || ''}</span>
        </div>
      )}
    </div>
  );
}
