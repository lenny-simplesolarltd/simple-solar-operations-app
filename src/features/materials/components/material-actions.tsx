'use client';

import { SimpleCommand } from '@/features/operations/simple-command';
import { IconPackage, IconPlus, IconTruck } from '@tabler/icons-react';

const NONE = '__none__';

/** MATERIAL_ADD: one requirement line on a job. */
export function AddMaterial({
  jobId,
  jobVersion,
  products,
  merchants
}: {
  jobId: string;
  jobVersion: number;
  products: { id: string; name: string; sku: string }[];
  merchants: { id: string; name: string }[];
}) {
  return (
    <SimpleCommand
      label='Add material'
      icon={<IconPlus />}
      variant='default'
      title='Add a material line'
      description='A catalogue product brings its unit and default merchant. For anything else give a description and unit.'
      request={{
        command_type: 'MATERIAL_ADD',
        job_id: jobId,
        expected_version: jobVersion
      }}
      fields={[
        {
          key: 'source',
          label: 'Where it comes from',
          kind: 'select',
          required: true,
          initial: 'ToOrder',
          options: [
            { value: 'ToOrder', label: 'Order from a merchant' },
            { value: 'AlreadyOrdered', label: 'Already ordered elsewhere' },
            { value: 'Stock', label: 'Take from our stock' }
          ]
        },
        {
          key: 'product_id',
          label: 'Product',
          kind: 'select',
          initial: NONE,
          options: [
            { value: NONE, label: 'Not in the catalogue' },
            ...products.map((p) => ({
              value: p.id,
              label: `${p.name} (${p.sku})`
            }))
          ]
        },
        {
          key: 'description',
          label: 'Description (if not a catalogue product)'
        },
        {
          key: 'unit',
          label: 'Unit (if not a catalogue product)',
          hint: 'e.g. Each, Metre'
        },
        {
          key: 'required_quantity',
          label: 'Quantity',
          kind: 'number',
          required: true
        },
        {
          key: 'merchant_id',
          label: 'Merchant',
          kind: 'select',
          initial: NONE,
          options: [
            { value: NONE, label: 'Product default' },
            ...merchants.map((m) => ({ value: m.id, label: m.name }))
          ]
        },
        {
          key: 'need_by_date',
          label: 'Needed on site by',
          kind: 'date',
          required: true
        },
        {
          key: 'already_ordered_reference',
          label: 'External order reference (already ordered only)'
        },
        { key: 'notes', label: 'Notes', kind: 'note' }
      ]}
      payload={(v) =>
        Object.fromEntries(
          Object.entries({
            source: v.source,
            product_id: v.product_id === NONE ? '' : v.product_id,
            description: v.description,
            unit: v.unit,
            required_quantity: v.required_quantity,
            merchant_id: v.merchant_id === NONE ? '' : v.merchant_id,
            need_by_date: v.need_by_date,
            already_ordered_reference: v.already_ordered_reference,
            notes: v.notes
          }).filter(([, x]) => x && x.trim())
        )
      }
    />
  );
}

/** ORDERS_BUILD: group this job's unordered lines into draft merchant orders. */
export function BuildOrders({
  jobId,
  pending
}: {
  jobId: string;
  pending: number;
}) {
  return (
    <SimpleCommand
      label='Build orders'
      icon={<IconTruck />}
      title='Build merchant orders'
      description={`Groups the ${pending} line${pending === 1 ? '' : 's'} still to order by merchant and trade into draft orders. Nothing is sent to a merchant yet.`}
      request={{ command_type: 'ORDERS_BUILD', job_id: jobId }}
      payload={() => ({})}
      disabled={pending === 0}
      disabledReason='Nothing left to order'
    />
  );
}

/** STOCK_RESERVE / STOCK_PICK / STOCK_ISSUE for one stock line. */
export function StockLineActions({
  jobId,
  item
}: {
  jobId: string;
  item: {
    material_id: string;
    reservation_id: string | null;
    reservation_version: number | null;
    reserved: number;
    picked: number;
    outstanding: number;
    ready: boolean;
  };
}) {
  if (!item.reservation_id) {
    return (
      <SimpleCommand
        label='Reserve'
        icon={<IconPackage />}
        title='Reserve stock'
        description='Sets stock aside in the store for this job. Leave the quantity blank to reserve everything outstanding.'
        request={{ command_type: 'STOCK_RESERVE', job_id: jobId }}
        fields={[{ key: 'quantity', label: 'Quantity', kind: 'number' }]}
        payload={(v) => ({
          material_id: item.material_id,
          ...(v.quantity ? { quantity: Number(v.quantity) } : {})
        })}
        disabled={!item.ready || item.outstanding <= 0}
        disabledReason='Nothing available or outstanding'
      />
    );
  }
  return (
    <span className='flex flex-wrap gap-1'>
      <SimpleCommand
        label='Pick'
        title='Record picked quantity'
        request={{
          command_type: 'STOCK_PICK',
          job_id: jobId,
          expected_version: item.reservation_version ?? undefined
        }}
        fields={[
          {
            key: 'picked_quantity',
            label: 'Picked',
            kind: 'number',
            required: true,
            initial: String(item.reserved)
          }
        ]}
        payload={(v) => ({
          reservation_id: item.reservation_id,
          picked_quantity: Number(v.picked_quantity)
        })}
      />
      <SimpleCommand
        label='Issue to job'
        title='Issue picked stock to the job'
        description='Moves the picked stock out of the store to the job site.'
        request={{
          command_type: 'STOCK_ISSUE',
          job_id: jobId,
          expected_version: item.reservation_version ?? undefined
        }}
        fields={[
          {
            key: 'quantity',
            label: 'Quantity (blank = all picked)',
            kind: 'number'
          }
        ]}
        payload={(v) => ({
          reservation_id: item.reservation_id,
          ...(v.quantity ? { quantity: Number(v.quantity) } : {})
        })}
        disabled={item.picked <= 0}
        disabledReason='Pick before issuing'
      />
    </span>
  );
}
