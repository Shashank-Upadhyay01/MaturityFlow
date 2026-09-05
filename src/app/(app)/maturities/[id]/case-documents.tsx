'use client';

import {
  BadgeCheck,
  FileText,
  ImageIcon,
  Paperclip,
  ShieldCheck,
  Upload,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { uploadCaseDocumentAction, verifyCaseDocumentAction } from '@/actions/documents';
import { DOCUMENT_KINDS, DOCUMENT_KIND_LABEL } from '@/lib/documents';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/field';
import { EmptyState } from '@/components/ui/misc';
import type { DocumentKind } from '@/db/schema';
import { cn } from '@/lib/utils';

export interface CaseDoc {
  id: string;
  kind: DocumentKind;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
  uploadedByName: string | null;
  verifiedAt: string | null;
  verifiedByName: string | null;
}

function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1_048_576) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1_048_576).toFixed(1)} MB`;
}

export function CaseDocuments({
  caseId,
  documents,
  canUpload,
  canVerify,
}: {
  caseId: string;
  documents: CaseDoc[];
  canUpload: boolean;
  canVerify: boolean;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [kind, setKind] = useState<DocumentKind>('MATURITY_FORM');
  const [dragging, setDragging] = useState(false);
  const [chosen, setChosen] = useState<string[]>([]);
  const [verifying, setVerifying] = useState<string | null>(null);

  const [state, formAction, pending] = useActionState(uploadCaseDocumentAction, null);

  useEffect(() => {
    if (state?.ok && state.data) {
      toast.success(
        `${state.data.count} document${state.data.count === 1 ? '' : 's'} attached`,
      );
      // Resetting the picker after a successful upload is exactly what an effect is for:
      // the trigger is a server response, not a render. The rule cannot tell the two apart.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setChosen([]);
      if (inputRef.current) inputRef.current.value = '';
      router.refresh();
    } else if (state && !state.ok) {
      toast.error(state.error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  function onFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    setChosen(Array.from(list).map((f) => f.name));
  }

  async function verify(id: string) {
    setVerifying(id);
    const r = await verifyCaseDocumentAction(id);
    setVerifying(null);
    if (r.ok) {
      toast.success('Document verified');
      router.refresh();
    } else {
      toast.error(r.error);
    }
  }

  const verifiedCount = documents.filter((d) => d.verifiedAt).length;

  return (
    <div className="space-y-4">
      {canUpload && (
        <form ref={formRef} action={formAction} className="space-y-3">
          <input type="hidden" name="caseId" value={caseId} />
          <input type="hidden" name="kind" value={kind} />

          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="flex-1">
              <span className="mb-1.5 block text-[0.8125rem] font-medium text-[var(--muted-fg)]">
                What is being attached?
              </span>
              <Select value={kind} onChange={(e) => setKind(e.target.value as DocumentKind)}>
                {DOCUMENT_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {DOCUMENT_KIND_LABEL[k]}
                  </option>
                ))}
              </Select>
            </label>
          </div>

          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              if (inputRef.current && e.dataTransfer.files.length) {
                inputRef.current.files = e.dataTransfer.files;
                onFiles(e.dataTransfer.files);
              }
            }}
            onClick={() => inputRef.current?.click()}
            className={cn(
              'flex cursor-pointer flex-col items-center justify-center rounded-[15px] border border-dashed px-5 py-7 text-center',
              'transition-all duration-300 [transition-timing-function:var(--ease-out-quint)]',
              dragging
                ? 'border-[var(--color-brand-500)] bg-[color-mix(in_oklab,var(--color-brand-500)_10%,transparent)]'
                : 'border-[var(--input-border)] hover:bg-[var(--glass-bg-subtle)]',
            )}
          >
            <Upload
              className={cn(
                'mb-2 h-6 w-6 transition-transform duration-300',
                dragging ? 'scale-110 text-[var(--color-brand-500)]' : 'text-[var(--faint-fg)]',
              )}
            />
            <p className="text-[0.875rem] font-medium">
              Drop files here, or click to choose
            </p>
            <p className="mt-1 text-[0.75rem] text-[var(--faint-fg)]">
              PDF or photo · up to 10 MB each · up to 10 at a time
            </p>
            <input
              ref={inputRef}
              name="files"
              type="file"
              multiple
              accept="application/pdf,image/jpeg,image/png,image/webp,image/heic,image/tiff"
              className="sr-only"
              onChange={(e) => onFiles(e.target.files)}
            />
          </div>

          {chosen.length > 0 && (
            <div className="mf-fade flex flex-wrap items-center gap-2">
              {chosen.map((n) => (
                <Badge key={n} tone="brand">
                  <Paperclip className="h-3 w-3" />
                  {n}
                </Badge>
              ))}
              <Button type="submit" variant="primary" size="sm" loading={pending} className="ml-auto">
                Attach {chosen.length} file{chosen.length === 1 ? '' : 's'}
              </Button>
            </div>
          )}
        </form>
      )}

      {documents.length === 0 ? (
        <EmptyState
          icon={<Paperclip className="h-6 w-6" />}
          title="No documents attached"
          description={
            canUpload
              ? 'Attach the maturity form and KYC papers so the approver can check them without chasing anyone.'
              : 'The agent has not attached anything to this case yet.'
          }
        />
      ) : (
        <>
          <div className="flex items-center justify-between gap-3 text-[0.75rem] text-[var(--muted-fg)]">
            <span>
              {documents.length} file{documents.length === 1 ? '' : 's'}
            </span>
            <span
              className={
                verifiedCount === documents.length
                  ? 'text-[var(--color-money-600)] dark:text-[var(--color-money-400)]'
                  : ''
              }
            >
              {verifiedCount} of {documents.length} verified
            </span>
          </div>

          <ul className="space-y-2">
            {documents.map((d, i) => {
              const isImage = d.mimeType.startsWith('image/');
              return (
                <li
                  key={d.id}
                  style={{ animationDelay: `${Math.min(i * 0.03, 0.2)}s` }}
                  className="mf-rise-row flex items-center gap-3 rounded-[13px] border border-[var(--input-border)] px-3.5 py-2.5"
                >
                  <span
                    className={cn(
                      'flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px]',
                      d.verifiedAt
                        ? 'bg-[color-mix(in_oklab,var(--color-money-500)_16%,transparent)] text-[var(--color-money-600)] dark:text-[var(--color-money-400)]'
                        : 'bg-[var(--glass-bg-subtle)] text-[var(--faint-fg)]',
                    )}
                  >
                    {isImage ? <ImageIcon className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
                  </span>

                  <div className="min-w-0 flex-1">
                    <a
                      href={`/api/documents/${d.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="block truncate text-[0.875rem] font-medium hover:text-[var(--color-brand-500)] hover:underline"
                    >
                      {d.fileName}
                    </a>
                    <p className="truncate text-[0.75rem] text-[var(--faint-fg)]">
                      {DOCUMENT_KIND_LABEL[d.kind]} · {humanBytes(d.sizeBytes)}
                      {d.uploadedByName ? ` · ${d.uploadedByName}` : ''}
                      {d.verifiedAt && d.verifiedByName ? ` · verified by ${d.verifiedByName}` : ''}
                    </p>
                  </div>

                  {d.verifiedAt ? (
                    <Badge tone="money">
                      <BadgeCheck className="h-3 w-3" />
                      verified
                    </Badge>
                  ) : canVerify ? (
                    <Button
                      size="sm"
                      variant="glass"
                      loading={verifying === d.id}
                      onClick={() => verify(d.id)}
                    >
                      <ShieldCheck className="h-3.5 w-3.5" />
                      Verify
                    </Button>
                  ) : (
                    <Badge tone="neutral">unverified</Badge>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
