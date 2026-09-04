'use client';

import { AlertTriangle } from 'lucide-react';
import { useEffect } from 'react';

import { Button } from '@/components/ui/button';
import { Glass } from '@/components/ui/glass';

/** Keeps the top bar if a page inside the workspace throws. */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <Glass className="mx-auto mt-12 max-w-md p-8 text-center">
      <AlertTriangle className="mx-auto h-8 w-8 text-[var(--color-warn-500)]" />
      <h1 className="mt-4 text-[1.25rem] font-semibold">This page could not open</h1>
      <p className="mt-2 text-[0.875rem] leading-relaxed text-[var(--muted-fg)]">
        The rest of the workspace is still there. Try again, or open Register from Daily work.
      </p>
      <Button className="mt-6" variant="primary" onClick={() => reset()}>
        Try again
      </Button>
    </Glass>
  );
}
