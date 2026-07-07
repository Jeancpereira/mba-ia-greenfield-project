import { generateSlug, SLUG_LENGTH } from './slug.util';

describe('generateSlug', () => {
  it('should generate slugs with exactly 11 characters', () => {
    for (let i = 0; i < 100; i++) {
      expect(generateSlug()).toHaveLength(SLUG_LENGTH);
    }
  });

  it('should only use URL-safe characters', () => {
    const urlSafe = /^[0-9a-zA-Z_-]+$/;
    for (let i = 0; i < 100; i++) {
      expect(generateSlug()).toMatch(urlSafe);
    }
  });

  it('should not generate duplicates in a large sample', () => {
    const sample = new Set<string>();
    for (let i = 0; i < 10000; i++) {
      sample.add(generateSlug());
    }
    expect(sample.size).toBe(10000);
  });
});
