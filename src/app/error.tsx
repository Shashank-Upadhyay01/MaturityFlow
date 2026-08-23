'use client';

import { AlertTriangle } from 'lucide-react';
import { useEffect } from 'react';

import { Button } from '@/components/ui/button';
import { Glass } from '@/components/ui/glass';

export default function ErrorPage({
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
    <main className="flex min-h-dvh items-center justify-center px-4">
      <Glass className="max-w-md p-8 text-center">
        <AlertTriangle className="mx-auto h-8 w-8 text-[var(--color-warn-500)]" />
        <h1 className="mt-4 text-[1.25rem] font-semibold">Something went wrong</h1>
        <p className="mt-2 text-[0.875rem] leading-relaxed text-[var(--muted-fg)]">
          The last action was not saved. Wait a moment and try again.
        </p>
        <Button className="mt-6" variant="primary" onClick={() => reset()}>
          Try again
        </Button>
      </Glass>
    </main>
  );
}
