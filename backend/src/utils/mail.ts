import nodemailer from "nodemailer";

interface SendEmailParams {
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
  attachments?: Array<{ filename: string; content: Buffer | string; contentType?: string; encoding?: string }>;
}

interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
  fromName: string;
}

function getSmtpConfig(): SmtpConfig | null {
  const host = process.env.SMTP_HOST;
  if (!host) return null;
  return {
    host,
    port: parseInt(process.env.SMTP_PORT ?? "587", 10),
    secure: process.env.SMTP_SECURE === "true",
    user: process.env.SMTP_USER ?? "",
    pass: process.env.SMTP_PASS ?? "",
    from: process.env.SMTP_FROM ?? process.env.SMTP_USER ?? "noreply@mdc.local",
    fromName: process.env.SMTP_FROM_NAME ?? "MDC System",
  };
}

let transporterCache: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter | null {
  const config = getSmtpConfig();
  if (!config) return null;

  if (!transporterCache) {
    transporterCache = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: config.user ? { user: config.user, pass: config.pass } : undefined,
    });
  }
  return transporterCache;
}

export async function sendEmail(params: SendEmailParams): Promise<{ ok: boolean; error?: string }> {
  const config = getSmtpConfig();
  if (!config) {
    return { ok: false, error: "SMTP not configured (set SMTP_HOST env var)" };
  }

  try {
    const transporter = getTransporter();
    if (!transporter) {
      return { ok: false, error: "Failed to create transporter" };
    }

    const recipients = Array.isArray(params.to) ? params.to.join(", ") : params.to;

    await transporter.sendMail({
      from: `"${config.fromName}" <${config.from}>`,
      to: recipients,
      subject: params.subject,
      text: params.text,
      html: params.html,
      attachments: params.attachments,
    });

    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
