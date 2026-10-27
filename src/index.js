/**
 * Page Watcher - Automation Pipeline Orchestrator
 * 
 * Runs a headless Playwright Chromium instance, monitors target URLs,
 * runs custom wait-and-act macros, detects bot roadblocks, and dispatches
 * dual SMS/Email alerts upon roadblocks or confirmation emails upon success.
 */

import { chromium } from 'playwright';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

import { detectCaptcha } from './captchaDetector.js';
import { triggerFallbackAlerts, sendSuccessEmail } from './alertService.js';
import { urlMacroRegistry, getMacroForUrl, RoadblockError } from './macros.js';

// Load environment variables from .env if present
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration options
const IS_HEADLESS = process.env.HEADLESS !== 'false';
const TIMEOUT_MS = parseInt(process.env.TIMEOUT_MS || '30000', 10);
const ENABLE_SCREENSHOTS = process.env.ENABLE_SCREENSHOTS === 'true';
const SCREENSHOT_DIR = path.resolve(__dirname, '../screenshots');

// Ensure screenshots folder exists for diagnostic artifacts if enabled
if (ENABLE_SCREENSHOTS && !fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

/**
 * Capture error screenshot for GitHub Actions artifact inspection.
 * Disabled by default on public repositories to prevent capturing rendered personal inputs.
 */
async function captureDiagnosticScreenshot(page, urlKey) {
  if (!ENABLE_SCREENSHOTS) {
    console.log('[Diagnostic] Screenshots disabled (set ENABLE_SCREENSHOTS=true in Secrets if private debug artifacts are needed).');
    return null;
  }
  try {
    const sanitizedKey = urlKey.replace(/[^a-z0-9]/gi, '_').toLowerCase().slice(0, 30);
    const filename = `error_${sanitizedKey}_${Date.now()}.png`;
    const filepath = path.join(SCREENSHOT_DIR, filename);
    await page.screenshot({ path: filepath, fullPage: true });
    console.log(`[Diagnostic] Saved error screenshot to: ${filepath}`);
    return filepath;
  } catch (err) {
    console.warn(`[Diagnostic] Could not capture screenshot: ${err.message}`);
    return null;
  }
}

/**
 * Main execution flow
 */
export async function runWatcher() {
  console.log('===========================================================');
  console.log(`🚀 Starting Page Watcher Pipeline - ${new Date().toISOString()}`);
  console.log(`Mode: Headless=${IS_HEADLESS}, Timeout=${TIMEOUT_MS}ms`);
  console.log('===========================================================');

  // Determine which URLs to process:
  // If WATCH_URLS is specified in environment (comma-separated), use those;
  // otherwise, default to all registered URLs in urlMacroRegistry.
  const configuredUrls = process.env.WATCH_URLS
    ? process.env.WATCH_URLS.split(',').map((u) => u.trim()).filter(Boolean)
    : Object.keys(urlMacroRegistry);

  if (configuredUrls.length === 0) {
    console.warn('⚠️ No target URLs configured to monitor. Exiting.');
    return;
  }

  console.log(`Configured Targets (${configuredUrls.length}):\n${configuredUrls.map(u => ` - ${u}`).join('\n')}\n`);

  // Launch Playwright Chromium
  const browser = await chromium.launch({
    headless: IS_HEADLESS,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage'
    ]
  });

  // Create isolated browser context with realistic fingerprint
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    locale: 'en-US',
    timezoneId: 'America/New_York'
  });

  let hasFailures = false;

  try {
    for (const targetUrl of configuredUrls) {
      console.log(`\n-----------------------------------------------------------`);
      console.log(`🔍 Inspecting Target: ${targetUrl}`);
      console.log(`-----------------------------------------------------------`);

      const macro = getMacroForUrl(targetUrl);
      if (!macro) {
        console.warn(`⚠️ No macro mapped for URL: ${targetUrl}. Skipping.`);
        continue;
      }

      const page = await context.newPage();
      page.setDefaultTimeout(TIMEOUT_MS);

      try {
        // 1. Navigate to target URL
        console.log(`[Navigation] Loading ${targetUrl}...`);
        await page.goto(targetUrl, {
          waitUntil: 'domcontentloaded',
          timeout: TIMEOUT_MS
        });
        // Allow dynamic client-side SPAs (e.g. React/Vue) to finish rendering API content
        await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});

        // 2. Proactive Roadblock / Captcha Check
        console.log('[Check] Scanning for Cloudflare / reCAPTCHA roadblocks...');
        const initialCaptcha = await detectCaptcha(page);
        if (initialCaptcha.detected) {
          throw new RoadblockError(
            `Proactive Captcha Check Failed: ${initialCaptcha.type}`,
            initialCaptcha.details
          );
        }

        // 3. Execute the mapped automation macro
        console.log(`[Macro] Running mapped macro for ${targetUrl}...`);
        const result = await macro({ page, targetUrl });

        // 4. Handle macro outcome
        if (result && result.triggered) {
          console.log(`🎉 [SUCCESS] Macro triggered and completed on: ${targetUrl}`);
          // Send success email notification to user with link to watched page
          await sendSuccessEmail({
            targetUrl,
            actionSummary: result.actionSummary
          });
        } else {
          console.log(`ℹ️ [STANDBY] ${result?.actionSummary || 'No state change detected. Monitoring continues.'}`);
        }

      } catch (error) {
        hasFailures = true;
        console.error(`❌ [ERROR] Roadblock or failure on ${targetUrl}:`, error.message);

        // Capture screenshot artifact for post-run analysis
        await captureDiagnosticScreenshot(page, targetUrl);

        // Immediate dual fallback alerting via SMS (TextBelt) and Email (Resend)
        const errorSummary = error.name === 'RoadblockError'
          ? `[Roadblock] ${error.message}`
          : `[Runtime Failure] ${error.message}`;

        const errorDetails = error.details
          ? `${error.details}\n\nStack:\n${error.stack}`
          : error.stack;

        await triggerFallbackAlerts({
          targetUrl,
          errorSummary,
          errorDetails
        });

      } finally {
        await page.close().catch(() => {});
      }
    }
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }

  console.log('\n===========================================================');
  if (hasFailures) {
    console.log('⚠️ Pipeline completed with roadblocks or errors. Fallback alerts were dispatched.');
    // Exit with code 1 so GitHub Actions can reflect the failure status if desired
    process.exit(1);
  } else {
    console.log('✅ Pipeline execution completed successfully without unhandled errors.');
  }
}

// Auto-run if executed as main file
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runWatcher().catch((err) => {
    console.error('Fatal unhandled error in watcher runner:', err);
    process.exit(1);
  });
}
