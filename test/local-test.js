/**
 * Local Pipeline Smoke Test
 * 
 * Verifies that:
 * 1. Chromium launches and renders dynamic HTML properly.
 * 2. Captcha detector flags Cloudflare and reCAPTCHA elements.
 * 3. The RSVP macro detects an open slot, fills out form inputs, and completes submission.
 */

import { chromium } from 'playwright';
import { detectCaptcha } from '../src/captchaDetector.js';
import { rsvpMacro } from '../src/macros.js';
import { maskSensitive } from '../src/utils.js';

async function runTests() {
  console.log('🧪 Starting local test suite...\n');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  let passed = 0;
  let total = 0;

  function assert(condition, testName) {
    total++;
    if (condition) {
      console.log(`  ✅ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`  ❌ [FAIL] ${testName}`);
    }
  }

  // --- Test 0: Privacy Masking Helper ---
  {
    console.log('Test 0: Log Privacy Masking');
    const maskedEmail = maskSensitive('jane.doe@example.com');
    assert(maskedEmail.startsWith('ja***') && maskedEmail.endsWith('@example.com'), 'Email correctly masked for logs');
    assert(!maskedEmail.includes('jane.doe'), 'Full email username is never exposed');

    const maskedPhone = maskSensitive('+15551234567');
    assert(maskedPhone.startsWith('+15***') && maskedPhone.endsWith('67'), 'Phone number correctly masked for logs');
    assert(!maskedPhone.includes('555123'), 'Full phone digits are never exposed');
  }

  // --- Test 1: Clean Page (No Captcha) ---
  {
    console.log('Test 1: Clean Page Verification');
    const page = await context.newPage();
    await page.setContent('<html><body><h1>Welcome</h1><p>Normal page content</p></body></html>');
    const result = await detectCaptcha(page);
    assert(result.detected === false, 'Clean page reports no captcha');
    await page.close();
  }

  // --- Test 2: Cloudflare Challenge Page Detection ---
  {
    console.log('\nTest 2: Cloudflare Challenge Detection');
    const page = await context.newPage();
    await page.setContent(`
      <html>
        <head><title>Just a moment...</title></head>
        <body><div id="challenge-running">Checking your browser...</div></body>
      </html>
    `);
    const result = await detectCaptcha(page);
    assert(result.detected === true, 'Cloudflare Challenge page title and element detected');
    assert(result.type.includes('Cloudflare'), 'Challenge identified as Cloudflare');
    await page.close();
  }

  // --- Test 3: reCAPTCHA Element Detection ---
  {
    console.log('\nTest 3: Google reCAPTCHA Detection');
    const page = await context.newPage();
    await page.setContent(`
      <html>
        <body>
          <form>
            <div class="g-recaptcha" data-sitekey="6Le-wvkSAAAAAPBMRTvw0Q4Muexq9bi0DJwx_mJ-"></div>
          </form>
        </body>
      </html>
    `);
    const result = await detectCaptcha(page);
    assert(result.detected === true, 'reCAPTCHA element detected in DOM');
    assert(result.type === 'Google reCAPTCHA', 'Identified as Google reCAPTCHA');
    await page.close();
  }

  // --- Test 4: RSVP Macro Automation Execution ---
  {
    console.log('\nTest 4: RSVP Wait-and-Act Automation Macro');
    const page = await context.newPage();
    await page.setContent(`
      <html>
        <body>
          <div id="status">Registration is Open!</div>
          <button id="open-rsvp" onclick="document.getElementById('modal').style.display='block'">RSVP</button>
          
          <div id="modal" style="display:none;">
            <form id="rsvp-form" onsubmit="event.preventDefault(); document.getElementById('confirmation').style.display='block';">
              <input type="text" name="name" placeholder="Your Name" />
              <input type="email" name="email" placeholder="Your Email" />
              <button type="submit" id="submit-btn">Complete RSVP</button>
            </form>
          </div>
          <div id="confirmation" style="display:none;">Thank you! Your spot is Confirmed.</div>
        </body>
      </html>
    `);

    process.env.REGISTRATION_NAME = 'Test User';
    process.env.REGISTRATION_EMAIL = 'test@example.com';

    const macroResult = await rsvpMacro({ page, targetUrl: 'https://test-event.local/rsvp' });
    assert(macroResult.triggered === true, 'Macro detected open slot and triggered');
    assert(macroResult.actionSummary.includes('Successfully registered'), 'Macro submitted and verified confirmation');
    await page.close();
  }

  // --- Test 5: Roadblock Abortion on Captcha-Guarded Page ---
  {
    console.log('\nTest 5: Roadblock Abortion on Captcha-Guarded Page');
    const page = await context.newPage();
    await page.setContent(`
      <html>
        <body>
          <div class="cf-turnstile"></div>
          <button>RSVP</button>
        </body>
      </html>
    `);

    let caughtError = null;
    try {
      await rsvpMacro({ page, targetUrl: 'https://test-event.local/blocked-rsvp' });
    } catch (err) {
      caughtError = err;
    }

    assert(caughtError !== null, 'Macro threw roadblock error on captcha presence');
    assert(caughtError?.name === 'RoadblockError', 'Error type is RoadblockError');
    assert(caughtError?.message.includes('Captcha'), 'Roadblock describes Captcha detection');
    await page.close();
  }

  await context.close();
  await browser.close();

  console.log(`\n===========================================================`);
  console.log(`Results: ${passed}/${total} tests passed.`);
  console.log(`===========================================================`);

  if (passed !== total) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
