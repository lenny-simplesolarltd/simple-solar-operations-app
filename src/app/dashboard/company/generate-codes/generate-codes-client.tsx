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

  return (
    <PageContainer>
      <div className='space-y-8'>
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
            <CardHeader>
              <CardTitle>Generated Codes</CardTitle>
              <CardDescription>
                Use these URLs to print labels or share links.
              </CardDescription>
            </CardHeader>
            <CardContent>
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
            </CardContent>
          </Card>
        )}
      </div>
    </PageContainer>
  );
}
