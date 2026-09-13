import { describe, it, expect } from 'vitest';
import { senderAddress } from './emailSender.js';

describe('senderAddress', () => {
  it('stays on the shared resend.dev address when nothing is configured', () => {
    expect(senderAddress('Rally Wedding', {})).toBe('Rally Wedding <noreply@resend.dev>');
    expect(senderAddress(undefined, { RESEND_FROM_EMAIL: '  ' })).toBe('Rally <noreply@resend.dev>');
  });

  it('uses the verified-domain address once one is set', () => {
    expect(senderAddress('Rally', { RESEND_FROM_EMAIL: ' noreply@mail.example.com ' })).toBe('Rally <noreply@mail.example.com>');
  });
});
