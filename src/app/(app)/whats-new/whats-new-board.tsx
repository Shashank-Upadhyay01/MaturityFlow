'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import {
  editUpdateAction,
  publishUpdateAction,
  removeUpdateAction,
  reportProblemAction,
  setProblemStatusAction,
} from '@/actions/whats-new';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { Glass } from '@/components/ui/glass';
import { cn } from '@/lib/utils';
import {
  BUG_SEVERITIES,
  BUG_STATUSES,
  UPDATE_KINDS,
  formatIndiaDay,
  formatIndiaWhen,
  indiaDayKey,
  kindLabel,
  parseUpdateDraft,
  reportScreens,
  screenLabel,
  severityLabel,
  statusLabel,
  updateCountLabel,
} from '@/lib/whats-new';
import type { AppUpdateKind, BugReportSeverity, BugReportStatus } from '@/db/schema';

type Tab = 'news' | 'problem' | 'inbox';

interface UpdateRow {
  id: string;
  title: string;
  body: string;
  kind: AppUpdateKind;
  publishedAt: string;
  authorName: string | null;
}

interface OwnReport {
  id: string;
  screen: string;
  tryingTo: string;
  whatHappened: string;
  extra: string | null;
  severity: BugReportSeverity;
  status: BugReportStatus;
  adminNote: string | null;
  createdAt: string;
}

interface AdminReport extends OwnReport {
  pagePath: string | null;
  reporterRole: string;
  userAgent: string | null;
  reporterName: string;
}

function toDateTimeLocal(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function WhatsNewBoard({
  tab,
  canWriteUpdates,
  canManageBugs,
  updates,
  mine,
  reports,
}: {
  tab: Tab;
  canWriteUpdates: boolean;
  canManageBugs: boolean;
  updates: UpdateRow[];
  mine: OwnReport[];
  reports: AdminReport[];
}) {
  const router = useRouter();
  const openCount = reports.filter((r) => r.status === 'OPEN' || r.status === 'LOOKING').length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1">
        <TabLink href="/whats-new" active={tab === 'news'}>
          What changed
        </TabLink>
        <TabLink href="/whats-new?tab=problem" active={tab === 'problem'}>
          Something is wrong
        </TabLink>
        {canManageBugs && (
          <TabLink href="/whats-new?tab=inbox" active={tab === 'inbox'}>
            Reports{openCount > 0 ? ` (${openCount})` : ''}
          </TabLink>
        )}
        <p className="ml-auto text-[0.8125rem] text-[var(--muted-fg)]">{updateCountLabel(updates.length)}</p>
      </div>

      {tab === 'news' && (
        <NewsTab canWrite={canWriteUpdates} updates={updates} onChanged={() => router.refresh()} />
      )}
      {tab === 'problem' && (
        <ProblemTab mine={mine} onChanged={() => router.refresh()} />
      )}
      {tab === 'inbox' && canManageBugs && (
        <InboxTab reports={reports} onChanged={() => router.refresh()} />
      )}
    </div>
  );
}

function TabLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        'inline-flex h-8 items-center rounded-[8px] px-3 text-[0.8125rem] font-semibold',
        active
          ? 'bg-[var(--color-brand-50)] text-[var(--color-brand-700)]'
          : 'text-[var(--muted-fg)] hover:bg-[var(--glass-bg-subtle)] hover:text-[var(--page-fg)]',
      )}
    >
      {children}
    </Link>
  );
}

function NewsTab({
  canWrite,
  updates,
  onChanged,
}: {
  canWrite: boolean;
  updates: UpdateRow[];
  onChanged: () => void;
}) {
  const grouped = useMemo(() => {
    const map = new Map<string, { label: string; rows: UpdateRow[] }>();
    for (const row of updates) {
      const key = indiaDayKey(row.publishedAt);
      const bucket = map.get(key) ?? { label: formatIndiaDay(row.publishedAt), rows: [] };
      bucket.rows.push(row);
      map.set(key, bucket);
    }
    return [...map.entries()];
  }, [updates]);

  return (
    <div className="space-y-3">
      {canWrite && <UpdateEditor onSaved={onChanged} />}
      {updates.length === 0 ? (
        <Glass className="px-5 py-8 text-center text-[0.875rem] text-[var(--muted-fg)]">
          No updates have been written yet.
          {canWrite ? ' Use the form above to tell people what changed.' : ''}
        </Glass>
      ) : (
        grouped.map(([day, bucket]) => (
          <section key={day} className="space-y-2">
            <h2 className="px-1 text-[0.75rem] font-semibold uppercase tracking-[0.08em] text-[var(--faint-fg)]">
              {bucket.label}
            </h2>
            {bucket.rows.map((row) => (
              <UpdateCard key={row.id} row={row} canWrite={canWrite} onChanged={onChanged} />
            ))}
          </section>
        ))
      )}
    </div>
  );
}

function UpdateEditor({
  initial,
  onSaved,
  onCancel,
}: {
  initial?: UpdateRow;
  onSaved: () => void;
  onCancel?: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [body, setBody] = useState(initial?.body ?? '');
  const [kind, setKind] = useState<AppUpdateKind>(initial?.kind ?? 'NEW');
  const [when, setWhen] = useState(initial ? toDateTimeLocal(initial.publishedAt) : '');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!when) setWhen(toDateTimeLocal(new Date().toISOString()));
  }, [when]);

  async function save() {
    setFormError(null);
    try {
      const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(when.trim());
      const at = match
        ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]))
        : new Date(when);
      if (!when || Number.isNaN(at.getTime())) {
        const message = 'Choose the day and time this change went out.';
        setFormError(message);
        toast.error(message);
        return;
      }
      const publishedAt = at.toISOString();
      const parsed = parseUpdateDraft({ title, body, kind, publishedAt });
      if (!parsed.ok) {
        setFormError(parsed.error);
        toast.error(parsed.error);
        return;
      }
      setBusy(true);
      const result = initial
        ? await editUpdateAction(initial.id, { title, body, kind, publishedAt })
        : await publishUpdateAction({ title, body, kind, publishedAt });
      setBusy(false);
      if (!result.ok) {
        setFormError(result.error);
        toast.error(result.error);
        return;
      }
      toast.success(initial ? 'Update saved' : 'Update published');
      if (!initial) {
        setTitle('');
        setBody('');
        setKind('NEW');
        setWhen(toDateTimeLocal(new Date().toISOString()));
      }
      onSaved();
      onCancel?.();
    } catch (error) {
      setBusy(false);
      const message = error instanceof Error ? error.message : 'Could not publish that update.';
      setFormError(message);
      toast.error(message);
    }
  }

  return (
    <Glass className="px-4 py-3 sm:px-5">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
      <p className="text-[0.8125rem] font-semibold">{initial ? 'Edit this update' : 'Write an update'}</p>
      <p className="mt-0.5 text-[0.75rem] text-[var(--muted-fg)]">
        Use everyday words. People at the counter should understand this in one glance.
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-[8rem_minmax(0,1fr)_13rem]">
        <Field label="What kind?">
          <Select value={kind} onChange={(e) => setKind(e.target.value as AppUpdateKind)}>
            {UPDATE_KINDS.map((k) => (
              <option key={k.id} value={k.id}>{k.label}</option>
            ))}
          </Select>
        </Field>
        <Field label="Short title">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="You can now pay a missed day" />
        </Field>
        <Field label="Day and time">
          <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
        </Field>
      </div>
      <Field label="Explain in plain words" className="mt-3">
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="What changed, who it helps, and what they should do differently."
        />
      </Field>
      {formError && (
        <p className="mt-2 text-[0.8125rem] font-medium text-[var(--color-danger-600)]" data-publish-error>
          {formError}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="submit" variant="primary" size="sm" loading={busy} data-testid="publish-update">
          {initial ? 'Save changes' : 'Publish'}
        </Button>
        {onCancel && (
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
      </form>
    </Glass>
  );
}

function UpdateCard({
  row,
  canWrite,
  onChanged,
}: {
  row: UpdateRow;
  canWrite: boolean;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const tone = row.kind === 'FIXED' ? 'money' : row.kind === 'IMPROVED' ? 'brand' : 'info';

  async function remove() {
    if (!window.confirm('Remove this update from the list?')) return;
    setBusy(true);
    const result = await removeUpdateAction(row.id);
    setBusy(false);
    if (!result.ok) return toast.error(result.error);
    toast.success('Update removed');
    onChanged();
  }

  if (editing) {
    return <UpdateEditor initial={row} onSaved={onChanged} onCancel={() => setEditing(false)} />;
  }

  return (
    <Glass className="px-4 py-3 sm:px-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={tone}>{kindLabel(row.kind)}</Badge>
            <h3 className="text-[0.9375rem] font-semibold">{row.title}</h3>
          </div>
          <p className="mt-1 text-[0.75rem] text-[var(--faint-fg)]">
            {formatIndiaWhen(row.publishedAt)}
            {row.authorName ? ` · ${row.authorName}` : ''}
          </p>
        </div>
        {canWrite && (
          <div className="flex gap-1">
            <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(true)}>
              Edit
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void remove()}>
              Remove
            </Button>
          </div>
        )}
      </div>
      <p className="mt-2 whitespace-pre-wrap text-[0.875rem] leading-relaxed">{row.body}</p>
    </Glass>
  );
}

function ProblemTab({ mine, onChanged }: { mine: OwnReport[]; onChanged: () => void }) {
  const screens = reportScreens();
  const [screen, setScreen] = useState('unsure');
  const [tryingTo, setTryingTo] = useState('');
  const [whatHappened, setWhatHappened] = useState('');
  const [extra, setExtra] = useState('');
  const [severity, setSeverity] = useState<BugReportSeverity>('ANNOYING');
  const [busy, setBusy] = useState(false);

  async function send() {
    setBusy(true);
    const result = await reportProblemAction({
      screen,
      tryingTo,
      whatHappened,
      extra,
      severity,
      pagePath: typeof window !== 'undefined' ? window.location.pathname : undefined,
    });
    setBusy(false);
    if (!result.ok) return toast.error(result.error);
    toast.success("We've got it. An admin will look at this.");
    setTryingTo('');
    setWhatHappened('');
    setExtra('');
    setScreen('unsure');
    setSeverity('ANNOYING');
    onChanged();
  }

  return (
    <div className="space-y-3">
      <Glass className="px-4 py-3 sm:px-5">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
        <p className="text-[0.9375rem] font-semibold">Tell us what went wrong</p>
        <p className="mt-1 text-[0.8125rem] leading-relaxed text-[var(--muted-fg)]">
          You do not need technical words. Say what you were doing, and what happened instead.
          We will also note which login you used and when you sent this.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="Which screen?">
            <Select value={screen} onChange={(e) => setScreen(e.target.value)}>
              {screens.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </Select>
          </Field>
          <Field label="How much did it get in the way?">
            <Select value={severity} onChange={(e) => setSeverity(e.target.value as BugReportSeverity)}>
              {BUG_SEVERITIES.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="What were you trying to do?" className="mt-3">
          <Input
            value={tryingTo}
            onChange={(e) => setTryingTo(e.target.value)}
            placeholder="Example: pay a customer for today"
          />
        </Field>
        <Field label="What happened instead?" className="mt-3">
          <Textarea
            value={whatHappened}
            onChange={(e) => setWhatHappened(e.target.value)}
            placeholder="Example: the page went blank, or the amount looked too high"
          />
        </Field>
        <Field label="Anything else? (optional)" className="mt-3">
          <Textarea
            value={extra}
            onChange={(e) => setExtra(e.target.value)}
            placeholder="Names, amounts, or the time of day — only if it helps"
          />
        </Field>
        <div className="mt-3">
          <Button type="submit" variant="primary" size="sm" loading={busy}>
            Send this
          </Button>
        </div>
        </form>
      </Glass>

      {mine.length > 0 && (
        <div className="space-y-2">
          <h2 className="px-1 text-[0.75rem] font-semibold uppercase tracking-[0.08em] text-[var(--faint-fg)]">
            Things you've told us
          </h2>
          {mine.map((row) => (
            <Glass key={row.id} className="px-4 py-3 sm:px-5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={row.severity === 'MONEY' ? 'danger' : row.severity === 'STOPPED_WORK' ? 'warn' : 'neutral'}>
                  {severityLabel(row.severity)}
                </Badge>
                <Badge tone={row.status === 'FIXED' ? 'money' : 'brand'}>{statusLabel(row.status)}</Badge>
                <span className="text-[0.75rem] text-[var(--faint-fg)]">{formatIndiaWhen(row.createdAt)}</span>
              </div>
              <p className="mt-2 text-[0.875rem] font-medium">{row.tryingTo}</p>
              <p className="mt-1 text-[0.8125rem] leading-relaxed text-[var(--muted-fg)]">{row.whatHappened}</p>
              {row.adminNote && (
                <p className="mt-2 rounded-[8px] bg-[var(--glass-bg-subtle)] px-3 py-2 text-[0.8125rem]">
                  From admin: {row.adminNote}
                </p>
              )}
            </Glass>
          ))}
        </div>
      )}
    </div>
  );
}

function InboxTab({ reports, onChanged }: { reports: AdminReport[]; onChanged: () => void }) {
  if (reports.length === 0) {
    return (
      <Glass className="px-5 py-8 text-center text-[0.875rem] text-[var(--muted-fg)]">
        Nobody has reported a problem yet.
      </Glass>
    );
  }
  return (
    <div className="space-y-2">
      {reports.map((row) => (
        <AdminReportCard key={row.id} row={row} onChanged={onChanged} />
      ))}
    </div>
  );
}

function AdminReportCard({ row, onChanged }: { row: AdminReport; onChanged: () => void }) {
  const [status, setStatus] = useState<BugReportStatus>(row.status);
  const [note, setNote] = useState(row.adminNote ?? '');
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const result = await setProblemStatusAction(row.id, status, note);
    setBusy(false);
    if (!result.ok) return toast.error(result.error);
    toast.success('Report updated');
    onChanged();
  }

  return (
    <Glass className="px-4 py-3 sm:px-5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={row.severity === 'MONEY' ? 'danger' : row.severity === 'STOPPED_WORK' ? 'warn' : 'neutral'}>
          {severityLabel(row.severity)}
        </Badge>
        <span className="text-[0.8125rem] font-medium">{row.reporterName}</span>
        <span className="text-[0.75rem] text-[var(--faint-fg)]">
          {row.reporterRole} · {screenLabel(row.screen)} · {formatIndiaWhen(row.createdAt)}
        </span>
      </div>
      <p className="mt-2 text-[0.875rem] font-medium">Trying to: {row.tryingTo}</p>
      <p className="mt-1 text-[0.8125rem] leading-relaxed">{row.whatHappened}</p>
      {row.extra && <p className="mt-1 text-[0.8125rem] text-[var(--muted-fg)]">Also: {row.extra}</p>}
      <div className="mt-3 grid gap-3 sm:grid-cols-[12rem_minmax(0,1fr)_auto] sm:items-end">
        <Field label="Status">
          <Select value={status} onChange={(e) => setStatus(e.target.value as BugReportStatus)}>
            {BUG_STATUSES.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </Select>
        </Field>
        <Field label="Note the person will see">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="This is fixed. Please try again." />
        </Field>
        <Button type="button" variant="primary" size="sm" loading={busy} onClick={() => void save()}>
          Save
        </Button>
      </div>
    </Glass>
  );
}
