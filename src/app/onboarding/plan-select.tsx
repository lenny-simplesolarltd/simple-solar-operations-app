'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

type PlanOption = {
  id: string;
  name: string;
  price: string;
  description: string;
};

const PLAN_OPTIONS: PlanOption[] = [
  {
    id: 'starter',
    name: 'Starter',
    price: '$0',
    description: 'Kick off with basic visibility while we set up scanning.'
  },
  {
    id: 'growth',
    name: 'Growth',
    price: '$199/mo',
    description: 'More volume, more reporting, and priority support.'
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    price: 'Custom',
    description: 'Multi-location, custom workflows, and dedicated onboarding.'
  }
];

export default function PlanSelect() {
  const [selectedPlan, setSelectedPlan] = useState<string>('starter');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const router = useRouter();

  const handleContinue = () => {
    setIsSubmitting(true);
    router.push('/dashboard/client');
  };

  return (
    <div className='bg-muted/20 flex min-h-screen items-center justify-center px-4 py-10'>
      <Card className='w-full max-w-2xl'>
        <CardHeader>
          <CardTitle>Choose your plan</CardTitle>
          <CardDescription>
            Pick the tier that matches your scanning volume. No payment is
            collected yet.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RadioGroup
            value={selectedPlan}
            onValueChange={setSelectedPlan}
            className='grid gap-4'
          >
            {PLAN_OPTIONS.map((plan) => {
              const isActive = selectedPlan === plan.id;
              return (
                <Label
                  key={plan.id}
                  htmlFor={plan.id}
                  className={cn(
                    'flex cursor-pointer items-start gap-3 rounded-lg border p-4',
                    isActive
                      ? 'border-primary bg-primary/5'
                      : 'border-muted-foreground/20'
                  )}
                >
                  <RadioGroupItem id={plan.id} value={plan.id} />
                  <div className='space-y-1'>
                    <div className='flex flex-wrap items-center gap-2'>
                      <span className='text-sm font-semibold'>{plan.name}</span>
                      <span className='text-muted-foreground text-sm'>
                        {plan.price}
                      </span>
                    </div>
                    <p className='text-muted-foreground text-sm'>
                      {plan.description}
                    </p>
                  </div>
                </Label>
              );
            })}
          </RadioGroup>
        </CardContent>
        <CardFooter className='flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between'>
          <p className='text-muted-foreground text-xs'>
            We will confirm pricing and set up scanning after you onboard.
          </p>
          <Button onClick={handleContinue} disabled={isSubmitting}>
            Continue to dashboard
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
