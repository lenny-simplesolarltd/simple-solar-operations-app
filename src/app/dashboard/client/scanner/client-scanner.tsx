'use client';

import { useCallback, useRef, useState } from 'react';
import { QrReader } from 'react-qr-reader';
import { toast } from 'sonner';
import { extractCodeId } from '@/lib/qr';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { IconAlertCircle, IconCamera, IconLoader2, IconRefresh } from '@tabler/icons-react';

type CodeDetails = {
  id: string;
  system_acronym: string;
  size: string;
  year: number;
  quantity: number;
  status_primary?: string | null;
  status_secondary?: string | null;
  notes?: string | null;
};

export default function ClientScanner() {
  const [code, setCode] = useState<CodeDetails | null>(null);
  const [notes, setNotes] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [isScanning, setIsScanning] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const lastScanRef = useRef<string | null>(null);

  const loadCode = useCallback(async (codeId: string) => {
    setIsLoading(true);
    setLookupError(null);
    try {
      const res = await fetch(`/api/codes/${codeId}`);

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Failed to load code');
      }

      const payload = await res.json();
      const data: CodeDetails = payload.code;
      setCode(data);
      setNotes(data.notes || '');
      setQuantity(data.quantity || 1);
      setIsScanning(false);
      toast.success('Code loaded');
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load code';
      setLookupError(message);
      toast.error(message);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleScan = useCallback(
    async (result: any, scanError: any) => {
      if (scanError) {
        const errorMessage = scanError?.message || scanError?.toString() || '';
        const isDecodeMiss =
          errorMessage.includes('NotFoundException') ||
          errorMessage.includes('ChecksumException') ||
          errorMessage.includes('FormatException') ||
          errorMessage.includes('selectBestPatterns');
        const isPermissionError =
          errorMessage.includes('Permission') ||
          errorMessage.includes('NotAllowedError') ||
          errorMessage.includes('denied') ||
          errorMessage.includes('NotFoundError');

        if (isDecodeMiss) {
          return;
        }

        if (isPermissionError) {
          setCameraError(
            'Unable to access camera. Please ensure camera permissions are granted.'
          );
          setIsScanning(false);
        }
        return;
      }

      if (!result || isLoading || !isScanning) return;

      const resultText = result?.text || result;
      if (!resultText) return;

      let codeId: string;
      try {
        codeId = extractCodeId(resultText);
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : 'Invalid QR code payload'
        );
        return;
      }

      if (lastScanRef.current === codeId) {
        return;
      }
      lastScanRef.current = codeId;

      const success = await loadCode(codeId);
      if (!success) {
        lastScanRef.current = null;
      }
    },
    [isLoading, isScanning, loadCode]
  );

  const handleSave = async () => {
    if (!code) return;

    setIsSaving(true);
    try {
      const res = await fetch(`/api/codes/${code.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notes,
          quantity
        })
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Failed to update code');
      }

      const payload = await res.json();
      setCode(payload.code);
      toast.success('Updates saved');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update code');
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = () => {
    setCode(null);
    setNotes('');
    setQuantity(1);
    setLookupError(null);
    setIsScanning(true);
    lastScanRef.current = null;
  };

  return (
    <Card>
      <CardHeader className='flex flex-col gap-2 md:flex-row md:items-center md:justify-between'>
        <div>
          <CardTitle className='flex items-center gap-2'>
            <IconCamera className='h-5 w-5' />
            Client Scanner
          </CardTitle>
          <CardDescription>
            Scan a TMGS code to view and update your inventory entry.
          </CardDescription>
        </div>
        <Button variant='outline' size='sm' onClick={handleReset}>
          <IconRefresh className='mr-2 h-4 w-4' />
          Scan another
        </Button>
      </CardHeader>
      <CardContent>
        <div className='grid gap-4 lg:grid-cols-[2fr,1fr]'>
          <div className='overflow-hidden rounded-lg border'>
            {cameraError ? (
              <div className='flex flex-col items-center justify-center rounded-lg border border-destructive/50 bg-destructive/10 p-8'>
                <IconAlertCircle className='mb-4 h-12 w-12 text-destructive' />
                <h3 className='mb-2 text-lg font-semibold'>Camera Error</h3>
                <p className='mb-4 text-center text-sm text-muted-foreground'>
                  {cameraError}
                </p>
                <Button
                  className='mt-2'
                  onClick={() => {
                    setCameraError(null);
                    setIsScanning(true);
                  }}
                >
                  Try Again
                </Button>
              </div>
            ) : (
              <div className='relative mx-auto h-[360px] w-full max-w-md overflow-hidden rounded-lg bg-black'>
                {isScanning && (
                  <>
                    <QrReader
                      onResult={handleScan}
                      constraints={{ facingMode: { ideal: 'environment' } }}
                      scanDelay={500}
                      containerStyle={{
                        position: 'absolute',
                        inset: 0,
                        width: '100%',
                        height: '100%'
                      }}
                      videoStyle={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover'
                      }}
                      ViewFinder={() => null}
                    />
                    <div className='pointer-events-none absolute inset-0 flex items-center justify-center'>
                      <div className='absolute inset-0 bg-black/30' />
                      <div className='relative z-10 h-56 w-56'>
                        <div className='absolute left-0 top-0 h-10 w-10 border-l-4 border-t-4 border-primary' />
                        <div className='absolute right-0 top-0 h-10 w-10 border-r-4 border-t-4 border-primary' />
                        <div className='absolute bottom-0 left-0 h-10 w-10 border-b-4 border-l-4 border-primary' />
                        <div className='absolute bottom-0 right-0 h-10 w-10 border-b-4 border-r-4 border-primary' />
                        <div className='absolute left-0 right-0 top-0 h-1 animate-scan bg-gradient-to-r from-transparent via-primary to-transparent' />
                      </div>
                    </div>
                    <div className='absolute bottom-4 left-1/2 z-20 -translate-x-1/2'>
                      <Badge className='bg-primary/90 backdrop-blur-sm'>
                        {isLoading ? (
                          <>
                            <IconLoader2 className='mr-2 h-3 w-3 animate-spin' />
                            Loading...
                          </>
                        ) : (
                          <>
                            <IconCamera className='mr-2 h-3 w-3' />
                            Scanning...
                          </>
                        )}
                      </Badge>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          <div className='space-y-4'>
            {lookupError && (
              <div className='rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive'>
                {lookupError}
              </div>
            )}

            <div className='rounded-lg border p-4'>
              <p className='text-sm text-muted-foreground'>Code details</p>
              {code ? (
                <div className='mt-2 space-y-2 text-sm'>
                  <div className='flex items-center justify-between'>
                    <span className='text-muted-foreground'>Code ID</span>
                    <span className='font-mono'>{code.id}</span>
                  </div>
                  <div className='flex items-center justify-between'>
                    <span className='text-muted-foreground'>System</span>
                    <span>{code.system_acronym}</span>
                  </div>
                  <div className='flex items-center justify-between'>
                    <span className='text-muted-foreground'>Size</span>
                    <span>{code.size}</span>
                  </div>
                  <div className='flex items-center justify-between'>
                    <span className='text-muted-foreground'>Year</span>
                    <span>{code.year}</span>
                  </div>
                  <div className='flex items-center justify-between'>
                    <span className='text-muted-foreground'>Quantity</span>
                    <span>{code.quantity}</span>
                  </div>
                  <div className='flex items-center justify-between'>
                    <span className='text-muted-foreground'>Status</span>
                    <span>
                      {code.status_primary || 'None'}
                      {code.status_secondary ? ` / ${code.status_secondary}` : ''}
                    </span>
                  </div>
                </div>
              ) : (
                <p className='mt-2 text-sm text-muted-foreground'>
                  Scan a code to view details.
                </p>
              )}
            </div>

            <div className='rounded-lg border p-4 space-y-3'>
              <p className='text-sm font-medium'>Update notes</p>
              <Textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder='Add notes about this item'
                rows={4}
                disabled={!code}
              />
              <div className='grid gap-2'>
                <label className='text-sm text-muted-foreground' htmlFor='client-quantity'>
                  Quantity
                </label>
                <Input
                  id='client-quantity'
                  type='number'
                  min={1}
                  value={quantity}
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    if (Number.isFinite(next) && next > 0) {
                      setQuantity(next);
                    } else {
                      setQuantity(1);
                    }
                  }}
                  disabled={!code}
                />
              </div>
              <Button onClick={handleSave} disabled={!code || isSaving}>
                {isSaving && <IconLoader2 className='mr-2 h-4 w-4 animate-spin' />}
                Save updates
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
