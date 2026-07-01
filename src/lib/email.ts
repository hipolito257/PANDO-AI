import { Resend } from "resend";

const FROM = process.env.EMAIL_FROM || "PANDO <onboarding@resend.dev>";

function client() {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  return new Resend(apiKey);
}

export async function sendPasswordResetEmail(to: string, resetUrl: string) {
  const resend = client();
  if (!resend) {
    console.error("[email] RESEND_API_KEY not set — skipping password reset email");
    return;
  }
  await resend.emails.send({
    from: FROM,
    to,
    subject: "Reset your PANDO password",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color:#004F46;">Reset your password</h2>
        <p style="color:#333; font-size: 14px; line-height: 1.5;">
          We received a request to reset your PANDO account password. Click the button below to choose a new one.
          This link expires in 1 hour.
        </p>
        <a href="${resetUrl}" style="display:inline-block; margin-top: 16px; padding: 12px 24px; background:#004F46; color:#fff; text-decoration:none; border-radius:8px; font-size:14px;">
          Reset Password
        </a>
        <p style="color:#888; font-size: 12px; margin-top: 24px;">
          If you didn't request this, you can safely ignore this email.
        </p>
      </div>
    `,
  });
}
