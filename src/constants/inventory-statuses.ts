export const INVENTORY_STATUSES = [
  'Activate',
  'Reactivate',
  'Deactivate',
  'In Use',
  'Warehouse/Staging',
  'In Staging',
  'In Transit',
  'Reuse',
  'Damaged',
  'Recycled',
  'Idle/Warehouse',
  'None'
] as const;

export type InventoryStatus = (typeof INVENTORY_STATUSES)[number];
