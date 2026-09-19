// Staff wording and colours for material and order states. Client-safe.

type Variant =
  | 'danger'
  | 'warning'
  | 'info'
  | 'success'
  | 'secondary'
  | 'outline';

export const MATERIAL_STATE: Record<
  string,
  { label: string; variant: Variant }
> = {
  ToOrder: { label: 'To order', variant: 'danger' },
  Drafted: { label: 'On a draft order', variant: 'warning' },
  AwaitingConfirmation: { label: 'Awaiting confirmation', variant: 'warning' },
  Confirmed: { label: 'Confirmed', variant: 'info' },
  PartReceived: { label: 'Part received', variant: 'warning' },
  Received: { label: 'Received', variant: 'success' },
  Stock: { label: 'From stock', variant: 'secondary' },
  VerifyExternalOrder: { label: 'Check external order', variant: 'warning' }
};

export const ORDER_STATUS: Record<string, { label: string; variant: Variant }> =
  {
    Draft: { label: 'Draft', variant: 'secondary' },
    Review: { label: 'Review', variant: 'warning' },
    Requested: { label: 'Sent', variant: 'warning' },
    Confirmed: { label: 'Confirmed', variant: 'info' },
    PartReceived: { label: 'Part received', variant: 'warning' },
    Received: { label: 'Received', variant: 'success' },
    Cancelled: { label: 'Cancelled', variant: 'outline' }
  };

export const ORDER_VIEWS: { value: string; label: string; statuses: string }[] =
  [
    {
      value: 'open',
      label: 'Open',
      statuses: 'Draft,Review,Requested,Confirmed,PartReceived'
    },
    { value: 'draft', label: 'To send', statuses: 'Draft,Review' },
    { value: 'sent', label: 'Awaiting confirmation', statuses: 'Requested' },
    { value: 'confirmed', label: 'Due in', statuses: 'Confirmed,PartReceived' },
    { value: 'received', label: 'Received', statuses: 'Received' },
    { value: 'cancelled', label: 'Cancelled', statuses: 'Cancelled' },
    { value: 'all', label: 'All', statuses: '' }
  ];
