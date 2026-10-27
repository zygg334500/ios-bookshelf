import { describe, expect, it } from 'vitest';
import { lookupClassical } from './classicalLexicon';

describe('classical lexicon', () => {
  it('prefers the longer word that covers the pressed character', () => {
    const text = '妻子相随';
    expect(lookupClassical(text, 0)?.word).toBe('妻子');
    expect(lookupClassical(text, 1)?.word).toBe('妻子');
    expect(lookupClassical(text, 0)?.senses[0]).toContain('儿女');
  });

  it('finds the same gloss under traditional forms', () => {
    expect(lookupClassical('為', 0)?.senses[0]).toContain('做');
    expect(lookupClassical('為', 0)?.word).toBe('為');
    expect(lookupClassical('其實', 1)?.word).toBe('其實');
  });

  it('returns nothing for an unlisted character, and lets extra entries override', () => {
    expect(lookupClassical('霾', 0)).toBeNull();
    const extra = lookupClassical('霾', 0, [{ keys: ['霾'], senses: ['空气里的浊气'] }]);
    expect(extra?.senses[0]).toBe('空气里的浊气');
  });
});