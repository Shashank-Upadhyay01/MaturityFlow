'use client';

import { Check, X } from 'lucide-react';
import type { MouseEvent as ReactMouseEvent } from 'react';

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

export function TakenMark({
  state,
  canMark,
  busy,
  onTaken,
  onNotTaken,
  className,
}: {
  state: DayState;
  /** Whether this actor may record payouts on this row at all. */
  canMark: boolean;
  /** A request for this day is already in flight. */
  busy: boolean;
  onTaken: () => void;
  /** `clear` is true when the cross is already set, which makes the click an undo. */
  onNotTaken: (clear: boolean) => void;
  className?: string;
}) {
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

  return (
    <div className={cn('flex items-center justify-center gap-1', className)}>
      <button
        type="button"
        disabled={shut}
        aria-label="Mark taken"
        aria-pressed={paid}
        title={blockedTitle ?? 'Taken — records this day’s scheduled amount in full'}
        onClick={(event) => {
          if (isSelectionGesture(event)) return;
          onTaken();
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
        title={
          blockedTitle ??
          (notTaken
            ? 'Not taken — click again to clear this mark'
            : 'Not taken — the customer did not collect. The amount stays owed.')
        }
        onClick={(event) => {
          if (isSelectionGesture(event)) return;
          onNotTaken(notTaken);
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
    </div>
  );
}
