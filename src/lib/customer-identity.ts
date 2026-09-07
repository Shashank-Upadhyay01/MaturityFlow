/** Account identifiers are text: preserve leading zeroes and punctuation. */
export const accountKey = (value: string): string => value.trim().replace(/\s+/g, '').toUpperCase();
export const customerNameKey = (value: string): string => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-IN');
