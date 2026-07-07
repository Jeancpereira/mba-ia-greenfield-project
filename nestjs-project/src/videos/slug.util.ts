import { customAlphabet } from 'nanoid';

export const SLUG_LENGTH = 11;

const SLUG_ALPHABET =
  '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-_';

const nanoidSlug = customAlphabet(SLUG_ALPHABET, SLUG_LENGTH);

export function generateSlug(): string {
  return nanoidSlug();
}
