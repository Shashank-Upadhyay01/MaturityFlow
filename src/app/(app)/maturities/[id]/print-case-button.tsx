'use client';

import { Printer } from 'lucide-react';

import { Button } from '@/components/ui/button';

export function PrintCaseButton() {
  return (
    <Button type="button" variant="glass" size="sm" className="print:hidden" onClick={() => window.print()}>
      <Printer className="h-4 w-4" />
      Print full details
    </Button>
  );
}
