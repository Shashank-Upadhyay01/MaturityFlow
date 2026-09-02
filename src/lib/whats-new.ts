/**
 * Plain-language vocabulary for What's new and "Something's wrong".
 * No money, no I/O. The pages and the server actions both import this.
 */
import { NAV, TOP_LEVEL_NAV } from '@/components/layout/nav-config';
import type { AppUpdateKind, BugReportSeverity, BugReportStatus } from '@/db/schema';

export const UPDATE_KINDS: { id: AppUpdateKind; label: string; hint: string }[] = [
  { id: 'NEW', label: 'New', hint: 'Something that was not there before' },
  { id: 'IMPROVED', label: 'Better', hint: 'Something that already existed, now easier' },
  { id: 'FIXED', label: 'Fixed', hint: 'Something that was going wrong, now put right' },
];

export const BUG_SEVERITIES: { id: BugReportSeverity; label: string; hint: string }[] = [
  { id: 'ANNOYING', label: "It's annoying", hint: 'I could still finish the work' },
  { id: 'STOPPED_WORK', label: 'I had to stop', hint: 'I could not finish what I started' },
  { id: 'MONEY', label: 'A number looked wrong', hint: 'A rupee figure, date or name did not look right' },
];

export const BUG_STATUSES: { id: BugReportStatus; label: string }[] = [
  { id: 'OPEN', label: "We've received this" },
  { id: 'LOOKING', label: "We're looking at it" },
  { id: 'FIXED', label: 'This is fixed' },
  { id: 'CLOSED', label: "We've closed this" },
];

export const UNSURE_SCREEN = 'unsure';
export const OTHER_SCREEN = 'other';

export function reportScreens(): { id: string; label: string }[] {
  const pages = [...TOP_LEVEL_NAV, ...NAV.flatMap((section) => section.items)].map((item) => ({
    id: item.href,
    label: item.label,
  }));
  return [
    { id: UNSURE_SCREEN, label: "I'm not sure which screen" },
    ...pages,
    { id: OTHER_SCREEN, label: 'Somewhere else' },
  ];
}

export function screenLabel(id: string): string {
  return reportScreens().find((s) => s.id === id)?.label ?? id;
}

export function kindLabel(kind: AppUpdateKind): string {
  return UPDATE_KINDS.find((k) => k.id === kind)?.label ?? kind;
}

export function severityLabel(severity: BugReportSeverity): string {
  return BUG_SEVERITIES.find((s) => s.id === severity)?.label ?? severity;
}

export function statusLabel(status: BugReportStatus): string {
  return BUG_STATUSES.find((s) => s.id === status)?.label ?? status;
}

const INDIA_WHEN = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  weekday: 'short',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

const INDIA_DAY = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

/** "Thu, 3 September 2026, 4:15 pm" in India time. */
export function formatIndiaWhen(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return INDIA_WHEN.format(date).replace(/\s(am|pm)$/i, (m) => m.toLowerCase());
}

export function formatIndiaDay(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return INDIA_DAY.format(date);
}

export function indiaDayKey(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function updateCountLabel(count: number): string {
  if (count === 0) return 'No updates yet';
  if (count === 1) return '1 update so far';
  return `${count} updates so far`;
}

export interface UpdateDraft {
  title: string;
  body: string;
  kind: AppUpdateKind;
  publishedAt: Date;
}

export interface BugDraft {
  screen: string;
  tryingTo: string;
  whatHappened: string;
  extra: string;
  severity: BugReportSeverity;
}

export function parseUpdateDraft(input: {
  title: string;
  body: string;
  kind: string;
  publishedAt: string;
}): { ok: true; value: UpdateDraft } | { ok: false; error: string } {
  const title = input.title.trim();
  const body = input.body.trim();
  if (title.length < 4) return { ok: false, error: 'Write a short title so people know what changed.' };
  if (title.length > 120) return { ok: false, error: 'The title is too long. Keep it to one short line.' };
  if (body.length < 12) return { ok: false, error: 'Explain the change in a sentence or two, in everyday words.' };
  if (body.length > 4000) return { ok: false, error: 'That explanation is too long. Keep it to a few short paragraphs.' };
  if (!UPDATE_KINDS.some((k) => k.id === input.kind)) {
    return { ok: false, error: 'Choose whether this is New, Better, or Fixed.' };
  }
  const publishedAt = new Date(input.publishedAt);
  if (Number.isNaN(publishedAt.getTime())) {
    return { ok: false, error: 'Choose the day and time this change went out.' };
  }
  return { ok: true, value: { title, body, kind: input.kind as AppUpdateKind, publishedAt } };
}

export function parseBugDraft(input: {
  screen: string;
  tryingTo: string;
  whatHappened: string;
  extra?: string;
  severity: string;
}): { ok: true; value: BugDraft } | { ok: false; error: string } {
  const screens = new Set(reportScreens().map((s) => s.id));
  if (!screens.has(input.screen)) {
    return { ok: false, error: 'Pick the screen where this happened, or say you are not sure.' };
  }
  const tryingTo = input.tryingTo.trim();
  const whatHappened = input.whatHappened.trim();
  const extra = (input.extra ?? '').trim();
  if (tryingTo.length < 8) {
    return { ok: false, error: 'Tell us what you were trying to do, in a short sentence.' };
  }
  if (tryingTo.length > 240) {
    return { ok: false, error: 'Keep "what you were trying to do" to a couple of sentences.' };
  }
  if (whatHappened.length < 8) {
    return { ok: false, error: 'Tell us what happened instead, in everyday words.' };
  }
  if (whatHappened.length > 4000) {
    return { ok: false, error: 'That description is too long. A few sentences is enough.' };
  }
  if (extra.length > 4000) {
    return { ok: false, error: 'The extra note is too long.' };
  }
  if (!BUG_SEVERITIES.some((s) => s.id === input.severity)) {
    return { ok: false, error: 'Choose how much this got in the way.' };
  }
  return {
    ok: true,
    value: {
      screen: input.screen,
      tryingTo,
      whatHappened,
      extra,
      severity: input.severity as BugReportSeverity,
    },
  };
}
