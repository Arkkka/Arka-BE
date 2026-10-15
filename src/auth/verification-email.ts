import nodemailer, { type Transporter } from 'nodemailer';
import type { Env } from '../config/env.js';

export interface VerificationEmailSender {
  sendVerificationCode(email: string, otp: string): Promise<void>;
}

export function createVerificationEmailSender(env: Env): VerificationEmailSender {
  const transporter: Transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: {
      user: env.SMTP_USER,
      pass: env.SMTP_PASSWORD,
    },
    connectionTimeout: env.SMTP_CONNECTION_TIMEOUT_MS,
    greetingTimeout: env.SMTP_GREETING_TIMEOUT_MS,
    socketTimeout: env.SMTP_SOCKET_TIMEOUT_MS,
  });

  return {
    async sendVerificationCode(email, otp) {
      await transporter.sendMail({
        from: `Arka <${env.SMTP_USER}>`,
        to: email,
        subject: 'Kode verifikasi akun Arka',
        text: `Kode verifikasi akun Arka Anda adalah ${otp}. Kode berlaku selama 5 menit. Jangan bagikan kode ini kepada siapa pun.`,
        html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#171712"><h1 style="font-size:24px">Verifikasi akun Arka</h1><p>Masukkan kode berikut untuk menyelesaikan pendaftaran:</p><p style="font-size:32px;font-weight:700;letter-spacing:8px">${otp}</p><p>Kode berlaku selama 5 menit. Jangan bagikan kode ini kepada siapa pun.</p></div>`,
      });
    },
  };
}
