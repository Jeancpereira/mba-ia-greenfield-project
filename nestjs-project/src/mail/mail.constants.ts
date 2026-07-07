export const MAIL_TEMPLATES = {
  CONFIRMATION: 'confirmation',
  PASSWORD_RESET: 'password-reset',
  ACCOUNT_EXISTS: 'account-exists',
} as const;

export const MAIL_SUBJECTS = {
  CONFIRMATION: 'Confirm your email — StreamTube',
  PASSWORD_RESET: 'Reset your password — StreamTube',
  ACCOUNT_EXISTS: 'You already have a StreamTube account',
} as const;
