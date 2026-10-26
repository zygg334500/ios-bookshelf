import { describe, expect, it } from 'vitest';
import { bonjourInstanceName, bonjourTxt, transferDetail } from './bonjour';

describe('bonjour identity', () => {
  it('publishes an ASCII instance even when the shelf name is Chinese', () => {
    const name = bonjourInstanceName('书房');
    expect(name).toMatch(/^BookShelf-[0-9a-f]{4}$/);
    expect(name).not.toContain('书');
    expect(bonjourInstanceName('书房')).toBe(name);
    expect(bonjourInstanceName('窗下')).not.toBe(name);
  });

  it('puts the display name in TXT and never the pairing PIN', () => {
    const txt = bonjourTxt('书房');
    expect(txt.name).toBe('书房');
    expect(txt.path).toBe('/v1/books');
    expect(txt.pinRequired).toBe('1');
    expect(txt).not.toHaveProperty('pin');
    expect(JSON.stringify(txt)).not.toContain('2468');
  });

  it('tells the user to type IP, port, and PIN when browse would return nothing', () => {
    const denied = transferDetail({
      bonjour: false,
      access: 'denied',
      ip: '192.168.1.20',
      wifi: true,
      vpn: false,
    });
    expect(denied).toContain('本地网络');
    expect(denied).toContain('0 台');
    expect(denied).toContain('配对码');
    expect(denied).not.toContain('2468');
  });
});
