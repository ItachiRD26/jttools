// LOCATION: lib/mailer.ts
// Nodemailer + Zoho SMTP — billing@jeterdev.tools

import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  host:   process.env.EMAIL_HOST   || "smtp.zoho.com",
  port:   Number(process.env.EMAIL_PORT || 465),
  secure: process.env.EMAIL_SECURE !== "false",
  auth: {
    user: process.env.EMAIL_USER || "billing@jeterdev.tools",
    pass: process.env.EMAIL_PASS || "",
  },
});

const FROM    = process.env.EMAIL_FROM    || '"JeterDev Tools" <billing@jeterdev.tools>';
const SUPPORT = process.env.EMAIL_SUPPORT || "billing@jeterdev.tools";
const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || "https://jeterdev.tools";
const LOGO_URL = "https://jeterdev.tools/logo.webp";

// ─── Base layout ─────────────────────────────────────────────────────────────
function baseLayout(content: string, preheader = "") {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>JeterDev Tools</title>
</head>
<body style="margin:0;padding:0;background:#0a0a0f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  ${preheader ? `<div style="display:none;max-height:0;overflow:hidden;">${preheader}</div>` : ""}
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0f;padding:40px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:560px;" cellpadding="0" cellspacing="0">

        <!-- Logo -->
        <tr><td align="center" style="padding-bottom:28px;">
          <a href="${BASE_URL}" style="text-decoration:none;display:inline-block;">
            <img src="${LOGO_URL}" alt="JeterDev Tools" width="48" height="48"
              style="display:block;width:48px;height:48px;object-fit:contain;border-radius:10px;" />
          </a>
        </td></tr>

        <!-- Card -->
        <tr><td style="background:#111118;border:1px solid rgba(127,119,221,0.15);border-radius:16px;overflow:hidden;">
          <div style="height:3px;background:linear-gradient(90deg,#7F77DD,#9F97FF);"></div>
          <div style="padding:32px 28px;">
            ${content}
          </div>
        </td></tr>

        <!-- Footer -->
        <tr><td style="padding-top:32px;text-align:center;">
          <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#7F77DD;letter-spacing:0.3px;">JeterDev Tools</p>
          <p style="margin:0 0 12px;font-size:11px;color:#6b6b80;line-height:1.6;">
            You're receiving this because you have an account on JeterDev Tools.<br/>
            Questions? <a href="mailto:${SUPPORT}" style="color:#7F77DD;text-decoration:underline;">${SUPPORT}</a>
          </p>
          <p style="margin:0;font-size:11px;color:#555566;">
            <a href="${BASE_URL}/terms" style="color:#6b6b80;text-decoration:none;">Terms</a>
            &nbsp;·&nbsp;
            <a href="${BASE_URL}/privacy" style="color:#6b6b80;text-decoration:none;">Privacy</a>
            &nbsp;·&nbsp;
            <span>© ${new Date().getFullYear()} JeterDev Tools</span>
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ─── Helper components ────────────────────────────────────────────────────────
const h1 = (text: string) =>
  `<h1 style="margin:0 0 8px;font-size:22px;font-weight:900;color:#ffffff;">${text}</h1>`;

const p = (text: string, color = "#c4c4d4", size = "15px") =>
  `<p style="margin:0 0 16px;font-size:${size};line-height:1.6;color:${color};">${text}</p>`;

const divider = () =>
  `<hr style="border:none;border-top:1px solid #2e2e44;margin:20px 0;" />`;

const btn = (text: string, url: string) =>
  `<div style="text-align:center;margin:24px 0;">
    <a href="${url}" style="display:inline-block;padding:12px 28px;background:#7F77DD;color:#fff;font-weight:700;font-size:15px;text-decoration:none;border-radius:10px;">${text}</a>
  </div>`;

const infoRow = (label: string, value: string, valueColor = "#9F97FF") =>
  `<tr>
    <td style="padding:8px 0;font-size:13px;color:#a0a0b8;">${label}</td>
    <td style="padding:8px 0;font-size:13px;font-weight:700;color:${valueColor};text-align:right;">${value}</td>
  </tr>`;

const infoTable = (rows: string) =>
  `<table width="100%" cellpadding="0" cellspacing="0" style="background:#1a1a2e;border-radius:10px;padding:4px 16px;margin-bottom:20px;">${rows}</table>`;

// ─── Email types ──────────────────────────────────────────────────────────────
export type EmailPayload =
  | { type: "plan_activated";     to: string; name: string; planName: string; amount: number; nextBillingDate: string }
  | { type: "renewal_reminder";   to: string; name: string; planName: string; amount: number; billingDate: string }
  | { type: "renewal_past_due";   to: string; name: string; planName: string; amount: number }
  | { type: "plan_downgraded";    to: string; name: string; reason: "non_payment" | "cancelled" }
  | { type: "plan_cancelled";     to: string; name: string; planName: string }
  | { type: "welcome";            to: string; name: string }

// ─── Build email ──────────────────────────────────────────────────────────────
function buildEmail(payload: EmailPayload): { subject: string; html: string; preheader: string } {
  switch (payload.type) {

    case "welcome":
      return {
        subject: "Welcome to JeterDev Tools 🚀",
        preheader: "Your Etsy API bridge is ready.",
        html: baseLayout(`
          ${h1("Welcome to JeterDev Tools 🚀")}
          ${p(`Hi <strong style="color:#fff;">${payload.name}</strong> — your account is ready. Generate your API key from the dashboard and start making requests to the Etsy API.`)}
          ${btn("Go to Dashboard", `${BASE_URL}/dashboard`)}
          ${divider()}
          ${p(`Questions? Reply to this email — we're happy to help.`, "#888899", "13px")}
        `, "Your Etsy API bridge is ready.")
      };

    case "plan_activated":
      return {
        subject: `✅ ${payload.planName} plan activated`,
        preheader: `Your ${payload.planName} plan is now active.`,
        html: baseLayout(`
          ${h1(`${payload.planName} Plan Activated ✅`)}
          ${p(`Your payment was successful. Your plan is now active and your API limits have been updated.`)}
          ${infoTable(
            infoRow("Plan",             payload.planName) +
            infoRow("Amount charged",   `$${payload.amount.toFixed(2)} USD`) +
            infoRow("Next billing date", new Date(payload.nextBillingDate).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }))
          )}
          ${p("Your API key has been updated automatically. No action needed.", "#a0a0b8", "13px")}
          ${btn("Go to Dashboard", `${BASE_URL}/dashboard`)}
        `, `${payload.planName} plan is now active.`)
      };

    case "renewal_reminder":
      return {
        subject: `⏰ Your ${payload.planName} plan renews in 2 days`,
        preheader: `$${payload.amount} due on ${payload.billingDate}.`,
        html: baseLayout(`
          ${h1("Renewal Reminder ⏰")}
          ${p(`Hi <strong style="color:#fff;">${payload.name}</strong> — your <strong style="color:#7F77DD;">${payload.planName}</strong> plan renews in <strong style="color:#fff;">2 days</strong>.`)}
          ${infoTable(
            infoRow("Plan",          payload.planName) +
            infoRow("Amount due",    `$${payload.amount.toFixed(2)} USD`) +
            infoRow("Billing date",  new Date(payload.billingDate).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }))
          )}
          ${p("To renew, visit your dashboard and click <strong>Renew Plan</strong>. If you don't renew, your account will be downgraded to Free after the billing date.", "#c4c4d4", "13px")}
          ${btn("Renew Now", `${BASE_URL}/pricing`)}
          ${divider()}
          ${p(`Want to cancel? You can do it anytime from your <a href="${BASE_URL}/dashboard" style="color:#7F77DD;">dashboard</a>.`, "#888899", "12px")}
        `, `$${payload.amount} due in 2 days.`)
      };

    case "renewal_past_due":
      return {
        subject: `⚠️ Your ${payload.planName} plan payment is overdue`,
        preheader: "Renew now to keep your API access.",
        html: baseLayout(`
          ${h1("Payment Overdue ⚠️")}
          ${p(`Hi <strong style="color:#fff;">${payload.name}</strong> — your <strong style="color:#7F77DD;">${payload.planName}</strong> plan payment is overdue.`)}
          ${infoTable(
            infoRow("Plan",        payload.planName) +
            infoRow("Amount due",  `$${payload.amount.toFixed(2)} USD`, "#f87171") +
            infoRow("Status",      "Past due", "#f87171")
          )}
          ${p("If you don't renew within <strong style=\"color:#fff;\">2 days</strong>, your account will be automatically downgraded to the Free plan and your current API key will be limited.", "#c4c4d4", "13px")}
          ${btn("Renew Now", `${BASE_URL}/pricing`)}
        `, "Renew now to keep your API access.")
      };

    case "plan_downgraded":
      return {
        subject: "Your plan has been downgraded to Free",
        preheader: "Your account is now on the Free plan.",
        html: baseLayout(`
          ${h1("Plan Downgraded to Free")}
          ${p(`Hi <strong style="color:#fff;">${payload.name}</strong> — your account has been downgraded to the <strong style="color:#7F77DD;">Free plan</strong> ${payload.reason === "non_payment" ? "due to non-payment" : "as requested"}.`)}
          ${infoTable(
            infoRow("Current plan", "Free") +
            infoRow("Daily limit",  "100 requests/day") +
            infoRow("Reason",       payload.reason === "non_payment" ? "Payment overdue" : "Cancelled by user")
          )}
          ${p("Your API key still works but is now limited to the Free plan. Upgrade anytime to restore your previous limits.", "#a0a0b8", "13px")}
          ${btn("Upgrade Plan", `${BASE_URL}/pricing`)}
        `, "Your account is now on the Free plan.")
      };

    case "plan_cancelled":
      return {
        subject: `${payload.planName} plan cancelled`,
        preheader: "Your plan has been cancelled successfully.",
        html: baseLayout(`
          ${h1("Plan Cancelled")}
          ${p(`Hi <strong style="color:#fff;">${payload.name}</strong> — your <strong style="color:#7F77DD;">${payload.planName}</strong> plan has been cancelled. Your account has been downgraded to Free.`)}
          ${infoTable(
            infoRow("Previous plan", payload.planName) +
            infoRow("Current plan",  "Free") +
            infoRow("Daily limit",   "100 requests/day")
          )}
          ${p("Your API key still works on the Free plan. You can upgrade again anytime.", "#a0a0b8", "13px")}
          ${btn("View Dashboard", `${BASE_URL}/dashboard`)}
          ${divider()}
          ${p(`We'd love to know why you cancelled. Reply to this email — your feedback helps us improve.`, "#888899", "12px")}
        `, "Your plan has been cancelled.")
      };

    default:
      throw new Error("Unknown email type");
  }
}

// ─── Send function ────────────────────────────────────────────────────────────
export async function sendEmail(payload: EmailPayload): Promise<boolean> {
  if (!process.env.EMAIL_PASS) {
    console.warn("[Email] EMAIL_PASS not set — skipping");
    return false;
  }

  try {
    const { subject, html } = buildEmail(payload);
    await transporter.sendMail({ from: FROM, to: payload.to, subject, html });
    console.log(`[Email] ✓ Sent ${payload.type} to ${payload.to}`);
    return true;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Email] ✗ Failed ${payload.type}:`, msg);
    return false;
  }
}