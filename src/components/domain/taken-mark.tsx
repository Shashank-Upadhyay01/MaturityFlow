'use client';

import { Check, X } from 'lucide-react';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { createPortal } from 'react-dom';

import { Button } from '@/components/ui/button';
import { markConfirmCopy, type MarkAction } from '@/lib/mark-confirm';
import { DAY_STATE_LABEL, type DayState } from '@/lib/register-view';
import { cn } from '@/lib/utils';

/**
 * The two marks a scheduled day is answered with: taken, or not taken.
 *
 * The Register and the Operations grid each grew their own pair and drifted apart — one screen's
 * ✓ opened a dialog while the other's recorded the payment, so the same gesture meant two
 * different things depending on which sheet the clerk happened to have open. Both render this
 * now; all either screen still decides is what the click does afterwards.
 *
 * Neither mark acts on the click any more. Each opens the confirmation below first, and the
 * screen's callback only runs once the clerk has confirmed it — so the guard cannot come off one
 * sheet and stay on the other, which is exactly how the two drifted the first time.
 *
 * A recorded payout is never reversed from here. Once the day is paid both marks go inert and
 * say where the correction is made instead, because un-ticking money that has already left the
 * drawer would be a reversal with no reason, no authorisation and nothing to read in the audit
 * trail. The cross is different: it records an observation rather than money, so clicking it a
 * second time clears it and that is the undo for a mis-click.
 */

const MARK =
  'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] transition-colors disabled:cursor-not-allowed disabled:opacity-50';

const PAID_TITLE =
  'Paid. A recorded payout is corrected by Admin / CMD / CEO on the case page, not by un-ticking it here.';

const NO_PERMISSION_TITLE = 'You do not record payouts on this row.';

/**
 * Both sheets build a cell selection with shift- and ctrl-click, so a modified click that lands
 * on a mark belongs to that gesture and must not move money. The Operations grid guarded its own
 * pair this way and the Register's did not; the guard belongs with the buttons, not with one
 * screen's copy of them.
 */
const isSelectionGesture = (event: ReactMouseEvent) =>
  event.shiftKey || event.ctrlKey || event.metaKey;

const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

export function TakenMark({
  state,
  canMark,
  busy,
  customerName,
  dueOn,
  amountPaise,
  needsReference = false,
  onTaken,
  onNotTaken,
  className,
}: {
  state: DayState;
  /** Whether this actor may record payouts on this row at all. */
  canMark: boolean;
  /** A request for this day is already in flight. */
  busy: boolean;
  /** Named in the confirmation, because "Are you sure?" is a dialog people learn to click through. */
  customerName: string;
  /** The scheduled day the marks answer, ISO. */
  dueOn: string;
  /** What the ✓ will record, or what stays owed behind a ✗. */
  amountPaise: bigint | string;
  /**
   * Whether any of this day goes out by transfer. INV-4 refuses the recording without a
   * reference, so the confirmation collects one rather than letting the server bounce the click.
   */
  needsReference?: boolean;
  /** Runs only once the clerk has confirmed. Carries the UTR when one was asked for. */
  onTaken: (reference: string | null) => void;
  /** `clear` is true when the cross is already set, which makes the click an undo. */
  onNotTaken: (clear: boolean) => void;
  className?: string;
}) {
  const [pending, setPending] = useState<MarkAction | null>(null);
  const [reference, setReference] = useState('');

  if (state === 'none') {
    return (
      <span className="text-[0.65rem] text-[var(--faint-fg)]" title={DAY_STATE_LABEL.none}>
        &mdash;
      </span>
    );
  }

  const paid = state === 'taken';
  const notTaken = state === 'missed';
  const shut = paid || !canMark || busy;
  const blockedTitle = paid ? PAID_TITLE : !canMark ? NO_PERMISSION_TITLE : null;

  const ask = (action: MarkAction) => {
    setReference('');
    setPending(action);
  };

  return (
    <div className={cn('flex items-center justify-center gap-1', className)}>
      <button
        type="button"
        disabled={shut}
        aria-label="Mark taken"
        aria-pressed={paid}
        aria-haspopup="dialog"
        title={blockedTitle ?? 'Taken — records this day’s scheduled amount in full'}
        onClick={(event) => {
          if (isSelectionGesture(event)) return;
          ask('taken');
        }}
        className={cn(
          MARK,
          'text-[var(--row-taken-fg)]',
          paid
            ? 'bg-[var(--row-taken-strong)] shadow-[inset_0_0_0_2px_var(--row-taken-edge)]'
            : 'bg-[var(--row-taken)] hover:bg-[var(--row-taken-strong)]',
        )}
      >
        <Check className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        disabled={shut}
        aria-label={notTaken ? 'Clear the not-taken mark' : 'Mark not taken'}
        aria-pressed={notTaken}
        aria-haspopup="dialog"
        title={
          blockedTitle ??
          (notTaken
            ? 'Not taken — click again to clear this mark'
            : 'Not taken — the customer did not collect. The amount stays owed.')
        }
        onClick={(event) => {
          if (isSelectionGesture(event)) return;
          ask(notTaken ? 'clearNotTaken' : 'notTaken');
        }}
        className={cn(
          MARK,
          'text-[var(--row-missed-fg)]',
          notTaken
            ? 'bg-[var(--row-missed-strong)] shadow-[inset_0_0_0_2px_var(--row-missed-edge)]'
            : 'bg-[var(--row-missed)] hover:bg-[var(--row-missed-strong)]',
        )}
      >
        <X className="h-3.5 w-3.5" />
      </button>
      {pending && (
        <MarkConfirmDialog
          action={pending}
          customerName={customerName}
          dueOn={dueOn}
          amountPaise={typeof amountPaise === 'bigint' ? amountPaise : BigInt(amountPaise || '0')}
          needsReference={needsReference}
          reference={reference}
          onReferenceChange={setReference}
          onCancel={() => setPending(null)}
          onConfirm={() => {
            const action = pending;
            const utr = reference.trim() || null;
            setPending(null);
            if (action === 'taken') onTaken(utr);
            else onNotTaken(action === 'clearNotTaken');
          }}
        />
      )}
    </div>
  );
}

/**
 * The confirmation itself, matching the payment dialog next door: same scrim, same opaque panel
 * on `--surface-solid`, same footer.
 *
 * It renders through a portal because the marks sit inside a table row whose panel carries
 * `.mf-rise` — an animation with `both` fill, so a `transform` stays applied and any `fixed`
 * descendant would be positioned against that row instead of the viewport.
 *
 * Everything a keyboard needs is here on purpose: Enter confirms (the panel is a form and the
 * confirm button submits it), Escape cancels, focus opens on the confirm button, and Tab cycles
 * inside the panel so a clerk cannot tab back onto the sheet and mark a second row by feel while
 * this is still open. When a UTR is required and still blank there is nothing to confirm yet, so
 * focus opens in that field instead — a disabled button cannot hold focus.
 */
function MarkConfirmDialog({
  action,
  customerName,
  dueOn,
  amountPaise,
  needsReference,
  reference,
  onReferenceChange,
  onCancel,
  onConfirm,
}: {
  action: MarkAction;
  customerName: string;
  dueOn: string;
  amountPaise: bigint;
  needsReference: boolean;
  reference: string;
  onReferenceChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const referenceRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const detailId = useId();

  const askReference = action === 'taken' && needsReference;
  const copy = markConfirmCopy(action, { customerName, dueOn, amountPaise });
  const ready = !askReference || reference.trim().length > 0;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  useEffect(() => {
    (askReference ? referenceRef.current : confirmRef.current)?.focus();
  }, [askReference]);

  /**
   * The panel takes its own keys and does not let them out.
   *
   * Both sheets listen for keys on the window — Escape drops a row selection, and the sheet
   * shortcuts read whatever is focused. Answering this dialog must not also reach past it and
   * clear the clerk's ticked rows, so Escape is handled here and stopped here; the window
   * listener above stays only as a fallback for a key that arrives with focus outside the panel.
   */
  function onPanelKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key !== 'Tab') return;
    const panel = panelRef.current;
    if (!panel) return;
    const stops = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (stops.length === 0) return;
    const first = stops[0]!;
    const last = stops[stops.length - 1]!;
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || !panel.contains(active)) {
      event.preventDefault();
      first.focus();
      return;
    }
    if (event.shiftKey ? active === first : active === last) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    }
  }

  // Nothing opens this but a click, so there is no server render to guard against — the check is
  // only so the module stays safe to import from a server-rendered tree.
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center p-3 sm:items-center"
      style={{ background: 'color-mix(in oklab, black 45%, transparent)' }}
      onClick={onCancel}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={detailId}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={onPanelKeyDown}
        className="w-full max-w-md rounded-[16px] border border-[var(--glass-border)] p-4 text-left shadow-[0_24px_60px_-20px_rgb(0_0_0/0.45)]"
        style={{ background: 'var(--surface-solid)' }}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (ready) onConfirm();
          }}
        >
          <p className="text-[0.68rem] font-bold uppercase tracking-[0.08em] text-[var(--color-brand-700)]">
            {copy.kicker}
          </p>
          <h2 id={titleId} className="mt-0.5 text-[1.05rem] font-semibold tracking-tight">
            {copy.question}
          </h2>
          <p id={detailId} className="mt-2 text-[0.78rem] text-[var(--muted-fg)]">
            {copy.detail}
          </p>

          {askReference && (
            <label className="mt-3 block text-[0.72rem] text-[var(--muted-fg)]">
              UTR / transfer reference
              <input
                ref={referenceRef}
                className="mf-input mt-1 h-9 w-full"
                value={reference}
                onChange={(event) => onReferenceChange(event.target.value)}
                placeholder="Required — part of this day goes out online"
                aria-label="UTR or transfer reference"
              />
              <span className="mt-1 block text-[0.68rem]">
                Without it there is nothing tying the transfer to this day, so the recording is
                refused rather than saved half-evidenced.
              </span>
            </label>
          )}

          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
              Cancel
            </Button>
            <Button ref={confirmRef} type="submit" variant={copy.tone} size="sm" disabled={!ready}>
              {copy.confirmLabel}
            </Button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
