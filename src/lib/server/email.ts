import { env } from "$env/dynamic/private";
import nodemailer from "nodemailer";

/**
 * Nodemailer 기반 이메일 전송기 설정
 * 환경 변수로부터 SMTP 설정을 불러와서 이메일 전송기를 생성합니다.
 */
export const mailSender = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: parseInt(env.SMTP_PORT),
    secure: env.SMTP_SECURITY === 'force_tls',
    auth: {
        user: env.SMTP_USERNAME,
        pass: env.SMTP_PASSWORD
    },
    from: env.SMTP_FROM,
});