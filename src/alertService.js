/**
 * Alerting & Fallback System
 * 
 * Dispatches fallback SMS (via TextBelt) and Email (via Resend) simultaneously
 * when an automation roadblock occurs, and dispatches confirmation emails upon successful macros.
 */

import { Resend } from 'resend';
import { maskSensitive } from './utils.js';

/**
 * Sends an SMS alert via TextBelt REST API
 * 
 * @param {Object} params
 * @param {string} params.targetUrl - URL of the page being monitored
 * @param {string} params.errorSummary - Brief summary of the roadblock or error
 * @returns {Promise<{success: boolean, details: any}>}
 */
export async function sendTextBeltSms({ targetUrl, errorSummary }) {
  const apiKey = process.env.TEXTBELT_API_KEY || 'textbelt';
  const phoneNumber = process.env.ALERT_PHONE_NUMBER;

  if (!phoneNumber) {
    console.warn('[TextBelt SMS] Skipped: ALERT_PHONE_NUMBER environment variable is not configured.');
    return { success: false, details: 'ALERT_PHONE_NUMBER missing' };
  }

  // Compose concise SMS (standard SMS length limit awareness)
  const message = `🚨 Page Watcher ALERT!\nRoadblock: ${errorSummary}\nTarget: ${targetUrl}\nManual action required.`;

  try {
    console.log(`[TextBelt SMS] Sending SMS alert to ${maskSensitive(phoneNumber)}...`);
    const response = await fetch('https://textbelt.com/text', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        phone: phoneNumber,
        message,
        key: apiKey
      })
    });

    const data = await response.json();
    if (data.success) {
      console.log(`[TextBelt SMS] Successfully sent SMS. Quota remaining: ${data.quotaRemaining ?? 'N/A'}`);
      return { success: true, details: data };
    } else {
      console.error(`[TextBelt SMS] Delivery failed:`, data.error || data);
      return { success: false, details: data.error || data };
    }
  } catch (error) {
    console.error(`[TextBelt SMS] Network error while calling TextBelt API:`, error.message);
    return { success: false, details: error.message };
  }
}

/**
 * Sends a fallback roadblock Email alert via Resend SDK
 * 
 * @param {Object} params
 * @param {string} params.targetUrl - URL of the page being monitored
 * @param {string} params.errorSummary - Roadblock description / captcha note
 * @param {string} [params.errorDetails] - Optional stack trace or verbose DOM detail
 * @returns {Promise<{success: boolean, details: any}>}
 */
export async function sendResendAlertEmail({ targetUrl, errorSummary, errorDetails }) {
  const resendApiKey = process.env.RESEND_API_KEY;
  const to = process.env.ALERT_EMAIL_TO;
  const from = process.env.ALERT_EMAIL_FROM || 'onboarding@resend.dev';

  if (!resendApiKey) {
    console.warn('[Resend Email] Skipped: RESEND_API_KEY environment variable is not configured.');
    return { success: false, details: 'RESEND_API_KEY missing' };
  }

  if (!to) {
    console.warn('[Resend Email] Skipped: ALERT_EMAIL_TO environment variable is not configured.');
    return { success: false, details: 'ALERT_EMAIL_TO missing' };
  }

  const resend = new Resend(resendApiKey);
  const timestamp = new Date().toISOString();

  const subject = `🚨 [Roadblock Alert] Action Needed for ${targetUrl}`;
  const htmlContent = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #fee2e2; border-radius: 8px; background-color: #fffaf0;">
      <h2 style="color: #dc2626; margin-top: 0;">🚨 Page Watcher Roadblock Encountered</h2>
      <p style="color: #374151; font-size: 16px;">
        An automated watcher task encountered an issue and requires your manual intervention.
      </p>
      
      <div style="background-color: #ffffff; padding: 16px; border-radius: 6px; border: 1px solid #e5e7eb; margin: 20px 0;">
        <p style="margin: 0 0 8px 0;"><strong>Watched URL:</strong></p>
        <p style="margin: 0 0 16px 0;"><a href="${targetUrl}" target="_blank" style="color: #2563eb; font-weight: bold; word-break: break-all;">${targetUrl}</a></p>
        
        <p style="margin: 0 0 8px 0;"><strong>Error / Roadblock:</strong></p>
        <p style="margin: 0 0 16px 0; color: #b91c1c; font-weight: 500;">${errorSummary}</p>
        
        <p style="margin: 0 0 4px 0;"><strong>Detected At:</strong> ${timestamp}</p>
      </div>

      ${errorDetails ? `
      <details style="margin-top: 16px; background-color: #f3f4f6; padding: 12px; border-radius: 6px;">
        <summary style="cursor: pointer; font-weight: bold; color: #4b5563;">Technical Diagnostics</summary>
        <pre style="white-space: pre-wrap; word-break: break-all; font-size: 12px; color: #1f2937; margin-top: 8px;">${errorDetails}</pre>
      </details>
      ` : ''}

      <div style="margin-top: 24px; text-align: center;">
        <a href="${targetUrl}" target="_blank" style="background-color: #dc2626; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
          Open Page & Complete Manually
        </a>
      </div>
      
      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0 12px 0;" />
      <p style="color: #9ca3af; font-size: 12px; margin: 0; text-align: center;">Sent by GitHub Actions Page Watcher Pipeline</p>
    </div>
  `;

  try {
    console.log(`[Resend Email] Sending roadblock email alert to ${maskSensitive(to)}...`);
    const { data, error } = await resend.emails.send({
      from,
      to,
      subject,
      html: htmlContent
    });

    if (error) {
      console.error(`[Resend Email] Failed to send email:`, error);
      return { success: false, details: error };
    }

    console.log(`[Resend Email] Successfully sent email alert. ID: ${data?.id}`);
    return { success: true, details: data };
  } catch (error) {
    console.error(`[Resend Email] Error sending email via Resend SDK:`, error.message);
    return { success: false, details: error.message };
  }
}

/**
 * Sends a success notification Email via Resend when a macro successfully executes
 * 
 * @param {Object} params
 * @param {string} params.targetUrl - URL of the page watched
 * @param {string} params.actionSummary - Summary of what action completed
 * @returns {Promise<{success: boolean, details: any}>}
 */
export async function sendSuccessEmail({ targetUrl, actionSummary }) {
  const resendApiKey = process.env.RESEND_API_KEY;
  const to = process.env.ALERT_EMAIL_TO;
  const from = process.env.ALERT_EMAIL_FROM || 'onboarding@resend.dev';

  if (!resendApiKey || !to) {
    console.log('[Resend Email] Skipping success email: RESEND_API_KEY or ALERT_EMAIL_TO not configured.');
    return { success: false, details: 'Credentials not configured' };
  }

  const resend = new Resend(resendApiKey);
  const timestamp = new Date().toISOString();

  const subject = `🎉 [Automation Success] Macro Completed on ${targetUrl}`;
  const htmlContent = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #bbf7d0; border-radius: 8px; background-color: #f0fdf4;">
      <h2 style="color: #15803d; margin-top: 0;">🎉 Automated Action Completed Successfully!</h2>
      <p style="color: #374151; font-size: 16px;">
        The scheduled wait-and-act pipeline detected available slots and successfully triggered the macro.
      </p>
      
      <div style="background-color: #ffffff; padding: 16px; border-radius: 6px; border: 1px solid #dcfce7; margin: 20px 0;">
        <p style="margin: 0 0 8px 0;"><strong>Watched URL:</strong></p>
        <p style="margin: 0 0 16px 0;"><a href="${targetUrl}" target="_blank" style="color: #16a34a; font-weight: bold; word-break: break-all;">${targetUrl}</a></p>
        
        <p style="margin: 0 0 8px 0;"><strong>Action Details:</strong></p>
        <p style="margin: 0 0 16px 0; color: #1f2937;">${actionSummary}</p>
        
        <p style="margin: 0 0 4px 0;"><strong>Timestamp:</strong> ${timestamp}</p>
      </div>

      <div style="margin-top: 24px; text-align: center;">
        <a href="${targetUrl}" target="_blank" style="background-color: #16a34a; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
          View Watched Page
        </a>
      </div>
      
      <hr style="border: none; border-top: 1px solid #dcfce7; margin: 24px 0 12px 0;" />
      <p style="color: #9ca3af; font-size: 12px; margin: 0; text-align: center;">Sent by GitHub Actions Page Watcher Pipeline</p>
    </div>
  `;

  try {
    console.log(`[Resend Email] Sending success confirmation email to ${maskSensitive(to)}...`);
    const { data, error } = await resend.emails.send({
      from,
      to,
      subject,
      html: htmlContent
    });

    if (error) {
      console.error(`[Resend Email] Failed to send success email:`, error);
      return { success: false, details: error };
    }

    console.log(`[Resend Email] Success email sent! ID: ${data?.id}`);
    return { success: true, details: data };
  } catch (error) {
    console.error(`[Resend Email] Error dispatching success email:`, error.message);
    return { success: false, details: error.message };
  }
}

/**
 * Triggers fallback system (SMS and Email simultaneously)
 * Uses Promise.allSettled so failure of one does not block the other.
 * 
 * @param {Object} params
 * @param {string} params.targetUrl
 * @param {string} params.errorSummary
 * @param {string} [params.errorDetails]
 */
export async function triggerFallbackAlerts({ targetUrl, errorSummary, errorDetails }) {
  console.log(`\n================== TRIGGERING FALLBACK ALERTS ==================`);
  console.log(`Target URL: ${targetUrl}`);
  console.log(`Reason:     ${errorSummary}`);
  console.log(`================================================================`);

  const [smsResult, emailResult] = await Promise.allSettled([
    sendTextBeltSms({ targetUrl, errorSummary }),
    sendResendAlertEmail({ targetUrl, errorSummary, errorDetails })
  ]);

  return {
    sms: smsResult.status === 'fulfilled' ? smsResult.value : { success: false, error: smsResult.reason },
    email: emailResult.status === 'fulfilled' ? emailResult.value : { success: false, error: emailResult.reason }
  };
}
