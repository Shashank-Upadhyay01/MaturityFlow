import { describe, expect, it } from 'vitest';
import { parseDisplayName, parseEmployeeCode, parsePhone, parseUsername } from '../src/lib/profile';

describe('parseUsername', () => {
  it('accepts a simple login name', () => {
    expect(parseUsername('Admin')).toEqual({ ok: true, username: 'admin' });
    expect(parseUsername('shashank.u')).toEqual({ ok: true, username: 'shashank.u' });
  });

  it('rejects reserved and malformed names', () => {
    expect(parseUsername('ab').ok).toBe(false);
    expect(parseUsername('1admin').ok).toBe(false);
    expect(parseUsername('me').ok).toBe(false);
    expect(parseUsername('root').ok).toBe(false);
    expect(parseUsername('a..b').ok).toBe(false);
    expect(parseUsername('admin-').ok).toBe(false);
  });
});

describe('parsePhone', () => {
  it('accepts Indian mobiles in a few common shapes', () => {
    expect(parsePhone('9876543210')).toEqual({ ok: true, phone: '9876543210' });
    expect(parsePhone('+91 98765 43210')).toEqual({ ok: true, phone: '9876543210' });
    expect(parsePhone('09876543210')).toEqual({ ok: true, phone: '9876543210' });
    expect(parsePhone('')).toEqual({ ok: true, phone: null });
  });

  it('rejects landlines and short numbers', () => {
    expect(parsePhone('12345').ok).toBe(false);
    expect(parsePhone('0123456789').ok).toBe(false);
  });
});

describe('parseDisplayName / employee code', () => {
  it('trims a name', () => {
    expect(parseDisplayName('  Shashank   Upadhyay ')).toEqual({
      ok: true,
      name: 'Shashank Upadhyay',
    });
  });

  it('uppercases an employee code', () => {
    expect(parseEmployeeCode('emp0003')).toEqual({ ok: true, employeeCode: 'EMP0003' });
    expect(parseEmployeeCode('')).toEqual({ ok: true, employeeCode: null });
  });
});
