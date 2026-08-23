/**
 * Document vocabulary — plain constants, deliberately NOT in the `'use server'` action file.
 *
 * Every export of a `'use server'` module is rewritten into an async server-action reference,
 * so exporting an array or an object from one hands the client a function instead of the value.
 * Anything a component needs to read (rather than call) has to live in a module like this.
 */

import type { DocumentKind } from '@/db/schema';

export const DOCUMENT_KINDS: DocumentKind[] = [
  'MATURITY_FORM',
  'ID_PROOF',
  'ADDRESS_PROOF',
  'PASSBOOK',
  'CANCELLED_CHEQUE',
  'PHOTO',
  'DISCHARGE_RECEIPT',
  'OTHER',
];

export const DOCUMENT_KIND_LABEL: Record<DocumentKind, string> = {
  MATURITY_FORM: 'Maturity form',
  ID_PROOF: 'ID proof',
  ADDRESS_PROOF: 'Address proof',
  PASSBOOK: 'Passbook',
  CANCELLED_CHEQUE: 'Cancelled cheque',
  PHOTO: 'Photograph',
  DISCHARGE_RECEIPT: 'Discharge receipt',
  OTHER: 'Other',
};

export function isDocumentKind(v: string): v is DocumentKind {
  return (DOCUMENT_KINDS as string[]).includes(v);
}
