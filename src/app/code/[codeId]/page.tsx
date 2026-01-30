'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card';
import { IconAlertCircle, IconLoader2, IconQrcode } from '@tabler/icons-react';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';

interface CodeInfo {
  id: string;
  system: string;
  size: string;
  year: number;
  created: string;
}

export default function PublicCodePage() {
  const params = useParams();
  const codeId = (params?.codeId as string) || '';
  const [codeInfo, setCodeInfo] = useState<CodeInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchCodeInfo() {
      if (!codeId) {
        setError('Invalid code ID');
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError(null);

        const response = await fetch(`/api/public/codes/${codeId}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            rawPayload: window.location.href
          })
        });

        if (!response.ok) {
          if (response.status === 404) {
            setError('Code not found');
          } else {
            setError('Failed to load code information');
          }
          return;
        }

        const data = await response.json();
        const code = data?.code;
        if (!code) {
          setError('Failed to load code information');
          return;
        }
        setCodeInfo({
          id: code.id,
          system: code.system_acronym,
          size: code.size,
          year: code.year,
          created: code.created_at
        });
      } catch (err) {
        console.error('Error fetching code info:', err);
        setError('Failed to load code information');
      } finally {
        setLoading(false);
      }
    }

    if (codeId) {
      fetchCodeInfo();
    }
  }, [codeId]);

  return (
    <div className='flex min-h-screen items-center justify-center bg-gradient-to-br from-background via-muted/20 to-background p-4'>
      <div className='w-full max-w-md'>
        {loading ? (
          <Card>
            <CardContent className='flex flex-col items-center justify-center py-12'>
              <IconLoader2 className='mb-4 h-12 w-12 animate-spin text-muted-foreground' />
              <p className='text-sm text-muted-foreground'>
                Loading code information...
              </p>
            </CardContent>
          </Card>
        ) : error ? (
          <Card className='border-destructive/50'>
            <CardContent className='flex flex-col items-center justify-center py-12'>
              <IconAlertCircle className='mb-4 h-12 w-12 text-destructive' />
              <h3 className='mb-2 text-lg font-semibold'>Error</h3>
              <p className='text-sm text-muted-foreground'>{error}</p>
            </CardContent>
          </Card>
        ) : codeInfo ? (
          <Card className='border-primary/20 bg-gradient-to-br from-card to-muted/20'>
            <CardHeader className='text-center'>
              <div className='mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10'>
                <IconQrcode className='h-8 w-8 text-primary' />
              </div>
              <CardTitle className='text-2xl'>QR Code Information</CardTitle>
              <CardDescription>
                Details for code: <strong>{codeInfo.id}</strong>
              </CardDescription>
            </CardHeader>
            <CardContent className='space-y-6'>
              {/* Code ID */}
              <div className='rounded-lg border bg-card p-4 text-center'>
                <p className='mb-2 text-sm font-medium text-muted-foreground'>
                  Code ID
                </p>
                <code className='text-2xl font-bold tracking-wider'>
                  {codeInfo.id}
                </code>
              </div>

              {/* Info Grid */}
              <div className='grid grid-cols-2 gap-4'>
                <div className='rounded-lg border bg-card p-4'>
                  <p className='mb-1 text-xs font-medium text-muted-foreground'>
                    System
                  </p>
                  <p className='text-lg font-semibold'>{codeInfo.system}</p>
                </div>
                <div className='rounded-lg border bg-card p-4'>
                  <p className='mb-1 text-xs font-medium text-muted-foreground'>
                    Size
                  </p>
                  <Badge variant='outline' className='text-base'>
                    {codeInfo.size}
                  </Badge>
                </div>
                <div className='rounded-lg border bg-card p-4'>
                  <p className='mb-1 text-xs font-medium text-muted-foreground'>
                    Year
                  </p>
                  <p className='text-lg font-semibold'>{codeInfo.year}</p>
                </div>
                <div className='rounded-lg border bg-card p-4'>
                  <p className='mb-1 text-xs font-medium text-muted-foreground'>
                    Created
                  </p>
                  <p className='text-sm'>
                    {new Date(codeInfo.created).toLocaleDateString()}
                  </p>
                </div>
              </div>

              {/* Footer Note */}
              <div className='rounded-lg bg-muted/50 p-3 text-center'>
                <p className='text-xs text-muted-foreground'>
                  This is a public view with basic information only.
                  <br />
                  Scan another QR code to view different code information.
                </p>
              </div>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
