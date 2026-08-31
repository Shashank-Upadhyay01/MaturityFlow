import { redirect } from 'next/navigation';

/** Kept only so old bookmarks never land on a dead page. */
export default function RetiredNewMaturityPage() {
  redirect('/maturity-operations');
}
