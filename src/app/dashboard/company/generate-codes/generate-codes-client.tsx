'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import PageContainer from '@/components/layout/page-container';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';

type GeneratedCode = {
  id: string;
  system_acronym: string;
  size: string;
  year: number;
  url: string;
};

const SIZE_OPTIONS = ['unspecified', 'XS', 'S', 'M', 'L', 'XL', 'XXL'];

export default function GenerateCodesClient() {
  const [count, setCount] = useState(10);
  const [size, setSize] = useState('unspecified');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPrinting, setIsPrinting] = useState(false);
  const [isZipping, setIsZipping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [codes, setCodes] = useState<GeneratedCode[]>([]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch('/api/company/generate-codes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          count,
          size
        })
      });

      if (!response.ok) {
        const payload = await response.json();
        throw new Error(payload.error || 'Failed to generate codes');
      }

      const payload = await response.json();
      setCodes(payload.codes || []);
      toast.success('Codes generated');
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to generate codes';
      setError(message);
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCopy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success('URL copied to clipboard');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to copy URL';
      toast.error(message);
    }
  };

  const handleDownloadCsv = () => {
    if (codes.length === 0) return;
    const escape = (value: string | number) =>
      `"${String(value).replace(/"/g, '""')}"`;
    const header = ['code', 'size', 'year', 'url'];
    const rows = codes.map((code) =>
      [code.id, code.size, code.year, code.url].map(escape).join(',')
    );
    const csv = [header.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `qr-codes-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    window.URL.revokeObjectURL(url);
  };

  const handleDownloadZip = async () => {
    if (codes.length === 0) return;
    setIsZipping(true);
    try {
      const qrcode = await import('qrcode');
      const { default: JSZip } = await import('jszip');
      const zip = new JSZip();
      const escape = (value: string | number) =>
        `"${String(value).replace(/"/g, '""')}"`;
      const header = ['code', 'size', 'year', 'url'];
      const rows = codes.map((code) =>
        [code.id, code.size, code.year, code.url].map(escape).join(',')
      );
      zip.file('codes.csv', [header.join(','), ...rows].join('\n'));

      await Promise.all(
        codes.map(async (code) => {
          const image = await qrcode.toDataURL(code.url, {
            margin: 1,
            width: 300
          });
          const base64 = image.split(',')[1] || '';
          zip.file(`qr-${code.id}.png`, base64, { base64: true });
        })
      );

      const blob = await zip.generateAsync({ type: 'blob' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `qr-codes-${new Date().toISOString().slice(0, 10)}.zip`;
      link.click();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to download ZIP';
      toast.error(message);
    } finally {
      setIsZipping(false);
    }
  };

  const handlePrintSheet = async () => {
    if (codes.length === 0) return;
    setIsPrinting(true);

    const escapeHtml = (value: string) =>
      value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    try {
      const qrcode = await import('qrcode');
      const items = await Promise.all(
        codes.map(async (code) => {
          const image = await qrcode.toDataURL(code.url, {
            margin: 1,
            width: 240
          });
          return { ...code, image };
        })
      );

      const printWindow = window.open('', '_blank');
      if (!printWindow) {
        throw new Error('Popup blocked');
      }

      const rows = items
        .map(
          (code) => `
            <div class="label">
              <img src="${code.image}" alt="QR code for ${escapeHtml(
                code.id
              )}" />
              <div class="meta">
                <div class="code">${escapeHtml(code.id)}</div>
                <div class="details">${escapeHtml(
                  `${code.size} • ${code.year}`
                )}</div>
              </div>
            </div>
          `
        )
        .join('');

      printWindow.document.open();
      printWindow.document.write(`
        <!doctype html>
        <html>
          <head>
            <meta charset="utf-8" />
            <title>QR Codes</title>
            <style>
              * { box-sizing: border-box; }
              body {
                font-family: Arial, sans-serif;
                margin: 24px;
                color: #111;
              }
              h1 {
                font-size: 18px;
                margin: 0 0 16px;
              }
              .grid {
                display: grid;
                grid-template-columns: repeat(2, minmax(0, 1fr));
                gap: 16px;
              }
              .label {
                border: 1px solid #e5e7eb;
                border-radius: 12px;
                padding: 12px;
                display: grid;
                justify-items: center;
                gap: 8px;
                page-break-inside: avoid;
              }
              .label img {
                width: 100%;
                max-width: 180px;
              }
              .meta {
                text-align: center;
                font-size: 12px;
              }
              .code {
                font-family: monospace;
                font-size: 14px;
                font-weight: 600;
              }
              @media print {
                body { margin: 0; }
              }
            </style>
          </head>
          <body>
            <h1>Generated QR Codes</h1>
            <div class="grid">${rows}</div>
            <script>
              const images = Array.from(document.images);
              let loaded = 0;
              const tryPrint = () => {
                loaded += 1;
                if (loaded >= images.length) {
                  window.print();
                  window.onafterprint = () => window.close();
                }
              };
              if (images.length === 0) {
                window.print();
              } else {
                images.forEach((img) => {
                  if (img.complete) {
                    tryPrint();
                  } else {
                    img.addEventListener('load', tryPrint);
                    img.addEventListener('error', tryPrint);
                  }
                });
              }
            </script>
          </body>
        </html>
      `);
      printWindow.document.close();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to print codes';
      toast.error(message);
    } finally {
      setIsPrinting(false);
    }
  };

  return (
    <PageContainer>
      <div className='w-full min-w-0 space-y-8'>
        <Card>
          <CardHeader>
            <CardTitle>Generate QR Codes</CardTitle>
            <CardDescription>
              Create a batch of unassigned QR codes for later scanning.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className='grid gap-4 md:grid-cols-[1fr,1fr,auto]'
              onSubmit={handleSubmit}
            >
              <div className='space-y-2'>
                <Label htmlFor='code-count'>How many codes?</Label>
                <Input
                  id='code-count'
                  type='number'
                  min={1}
                  max={200}
                  value={count}
                  onChange={(event) =>
                    setCount(Number.parseInt(event.target.value, 10) || 0)
                  }
                />
              </div>
              <div className='space-y-2'>
                <Label htmlFor='code-size'>Size</Label>
                <Select value={size} onValueChange={setSize}>
                  <SelectTrigger id='code-size'>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SIZE_OPTIONS.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className='flex items-end'>
                <Button type='submit' disabled={isSubmitting}>
                  {isSubmitting ? 'Generating...' : 'Generate Codes'}
                </Button>
              </div>
            </form>
            {error && <p className='text-destructive mt-3 text-sm'>{error}</p>}
          </CardContent>
        </Card>

        {codes.length > 0 && (
          <Card>
            <CardHeader className='flex flex-col gap-3 md:flex-row md:items-center md:justify-between'>
              <div>
                <CardTitle>Generated Codes</CardTitle>
                <CardDescription>
                  Use these URLs to print labels or share links.
                </CardDescription>
              </div>
              <div className='flex flex-wrap gap-2'>
                <Button variant='outline' size='sm' onClick={handleDownloadCsv}>
                  Download CSV
                </Button>
                <Button
                  variant='outline'
                  size='sm'
                  onClick={handleDownloadZip}
                  disabled={isZipping}
                >
                  {isZipping ? 'Preparing...' : 'Download ZIP'}
                </Button>
                <Button
                  variant='outline'
                  size='sm'
                  onClick={handlePrintSheet}
                  disabled={isPrinting}
                >
                  {isPrinting ? 'Preparing...' : 'Print Sheet'}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className='overflow-x-auto'>
                <Table className='min-w-[720px]'>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Code</TableHead>
                      <TableHead>Size</TableHead>
                      <TableHead>Year</TableHead>
                      <TableHead>URL</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {codes.map((code) => (
                      <TableRow key={code.id}>
                        <TableCell className='font-mono text-sm'>
                          {code.id}
                        </TableCell>
                        <TableCell className='text-sm'>{code.size}</TableCell>
                        <TableCell className='text-sm'>{code.year}</TableCell>
                        <TableCell className='text-sm'>
                          <a
                            className='text-primary hover:underline'
                            href={code.url}
                            target='_blank'
                            rel='noreferrer'
                          >
                            {code.url}
                          </a>
                        </TableCell>
                        <TableCell>
                          <Button
                            variant='outline'
                            size='sm'
                            onClick={() => handleCopy(code.url)}
                          >
                            Copy
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </PageContainer>
  );
}
