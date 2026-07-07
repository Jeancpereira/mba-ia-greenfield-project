export abstract class DomainException extends Error {
  constructor(
    public readonly errorCode: string,
    public readonly httpStatus: number,
    message: string,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class InvalidCredentialsException extends DomainException {
  constructor() {
    super('INVALID_CREDENTIALS', 401, 'Invalid email or password');
  }
}

export class EmailNotConfirmedException extends DomainException {
  constructor() {
    super('EMAIL_NOT_CONFIRMED', 403, 'Email address has not been confirmed');
  }
}

export class InvalidTokenException extends DomainException {
  constructor() {
    super('INVALID_TOKEN', 401, 'Token is invalid');
  }
}

export class TokenExpiredException extends DomainException {
  constructor() {
    super('TOKEN_EXPIRED', 401, 'Token has expired');
  }
}

export class TokenReuseDetectedException extends DomainException {
  constructor() {
    super(
      'TOKEN_REUSE_DETECTED',
      401,
      'Token reuse detected — all sessions revoked',
    );
  }
}

export class VideoNotFoundException extends DomainException {
  constructor() {
    super('VIDEO_NOT_FOUND', 404, 'Video not found');
  }
}

export class NotVideoOwnerException extends DomainException {
  constructor() {
    super('NOT_VIDEO_OWNER', 403, 'You do not own this video');
  }
}

export class InvalidUploadStateException extends DomainException {
  constructor() {
    super(
      'INVALID_UPLOAD_STATE',
      409,
      'Video is not in a state that accepts upload operations',
    );
  }
}

export class UploadIncompleteException extends DomainException {
  constructor() {
    super(
      'UPLOAD_INCOMPLETE',
      400,
      'Storage rejected the upload completion — missing parts or ETag mismatch',
    );
  }
}

export class SlugGenerationFailedException extends DomainException {
  constructor() {
    super(
      'SLUG_GENERATION_FAILED',
      500,
      'Could not generate a unique video slug',
    );
  }
}

export class VideoFileSizeMismatchException extends DomainException {
  constructor() {
    super(
      'VIDEO_FILE_SIZE_MISMATCH',
      422,
      'Uploaded object size exceeds the maximum allowed size or does not match the declared file size',
    );
  }
}
