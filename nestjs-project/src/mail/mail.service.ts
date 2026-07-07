import { MailerService } from '@nestjs-modules/mailer';
import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import appConfig from '../config/app.config';
import { MAIL_SUBJECTS, MAIL_TEMPLATES } from './mail.constants';

@Injectable()
export class MailService {
  private readonly appUrl: string;

  constructor(
    private readonly mailerService: MailerService,
    @Inject(appConfig.KEY) app: ConfigType<typeof appConfig>,
  ) {
    this.appUrl = app.url;
  }

  async sendConfirmationEmail(
    email: string,
    name: string,
    token: string,
  ): Promise<void> {
    const confirmationUrl = `${this.appUrl}/confirm-email?token=${token}`;
    await this.mailerService.sendMail({
      to: email,
      subject: MAIL_SUBJECTS.CONFIRMATION,
      template: MAIL_TEMPLATES.CONFIRMATION,
      context: { name, confirmationUrl },
    });
  }

  async sendPasswordResetEmail(
    email: string,
    name: string,
    token: string,
  ): Promise<void> {
    const resetUrl = `${this.appUrl}/reset-password?token=${token}`;
    await this.mailerService.sendMail({
      to: email,
      subject: MAIL_SUBJECTS.PASSWORD_RESET,
      template: MAIL_TEMPLATES.PASSWORD_RESET,
      context: { name, resetUrl },
    });
  }

  async sendAccountAlreadyExistsEmail(
    email: string,
    name: string,
  ): Promise<void> {
    const loginUrl = `${this.appUrl}/login`;
    const forgotPasswordUrl = `${this.appUrl}/forgot-password`;
    // Single generic template for both confirmed and unconfirmed accounts:
    // register()'s anti-enumeration flow never (re)issues a confirmation
    // token itself (that would let a stranger clobber the victim's active
    // token), so an unconfirmed owner is pointed at the legitimate,
    // rate-limited resend endpoint instead. The email body is only ever
    // seen by the real account owner in her inbox, so always including the
    // resend link alongside login/reset links leaks nothing to the caller
    // of /auth/register and avoids maintaining two near-duplicate templates.
    const resendConfirmationUrl = `${this.appUrl}/resend-confirmation`;
    await this.mailerService.sendMail({
      to: email,
      subject: MAIL_SUBJECTS.ACCOUNT_EXISTS,
      template: MAIL_TEMPLATES.ACCOUNT_EXISTS,
      context: { name, loginUrl, forgotPasswordUrl, resendConfirmationUrl },
    });
  }
}
