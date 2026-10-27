/**
 * Proactive Captcha & Challenge Detector
 * 
 * Inspects the Playwright Page DOM and frames for Cloudflare challenges,
 * Cloudflare Turnstile, Google reCAPTCHA, and hCaptcha roadblock elements.
 */

export async function detectCaptcha(page) {
  try {
    // 1. Check page title and visible challenge markers for Cloudflare / DDoS walls
    const title = await page.title().catch(() => '');
    if (
      title.includes('Just a moment...') ||
      title.includes('Attention Required! | Cloudflare') ||
      title.includes('DDOS-GUARD') ||
      title.includes('Security Check')
    ) {
      return {
        detected: true,
        type: 'Cloudflare Challenge Page',
        details: `Page title indicates active challenge wall: "${title}"`
      };
    }

    // 2. Selectors targeting Cloudflare Challenge & Turnstile
    const cloudflareSelectors = [
      '#challenge-running',
      '#challenge-form',
      '#cf-challenge-running',
      '.cf-turnstile',
      '#turnstile-wrapper',
      'iframe[src*="challenges.cloudflare.com"]',
      'iframe[src*="cloudflare.com/cdn-cgi/challenge-platform"]',
      '[name="cf-turnstile-response"]',
      'div[id*="cf-turnstile"]'
    ];

    for (const selector of cloudflareSelectors) {
      const el = await page.$(selector);
      if (el) {
        const isVisible = await el.isVisible().catch(() => false);
        return {
          detected: true,
          type: 'Cloudflare / Turnstile',
          details: `Found Cloudflare element matching selector "${selector}" (visible: ${isVisible})`
        };
      }
    }

    // 3. Selectors targeting Google reCAPTCHA (v2 / v3)
    const recaptchaSelectors = [
      '.g-recaptcha',
      '#g-recaptcha-response',
      'iframe[src*="google.com/recaptcha"]',
      'iframe[src*="recaptcha.net/recaptcha"]',
      'iframe[title*="reCAPTCHA"]',
      'div.recaptcha-checkbox',
      '.grecaptcha-badge'
    ];

    for (const selector of recaptchaSelectors) {
      const el = await page.$(selector);
      if (el) {
        // Note: For grecaptcha-badge or invisible tokens, presence in DOM is often a roadblock
        return {
          detected: true,
          type: 'Google reCAPTCHA',
          details: `Found reCAPTCHA element matching selector "${selector}"`
        };
      }
    }

    // 4. Selectors targeting hCaptcha
    const hcaptchaSelectors = [
      '.h-captcha',
      'iframe[src*="hcaptcha.com"]',
      'iframe[data-hcaptcha-widget-id]',
      '[name="h-captcha-response"]'
    ];

    for (const selector of hcaptchaSelectors) {
      const el = await page.$(selector);
      if (el) {
        return {
          detected: true,
          type: 'hCaptcha',
          details: `Found hCaptcha element matching selector "${selector}"`
        };
      }
    }

    // 5. Inspect nested frames for challenge sources
    for (const frame of page.frames()) {
      const frameUrl = frame.url();
      if (
        frameUrl.includes('challenges.cloudflare.com') ||
        frameUrl.includes('challenge-platform') ||
        frameUrl.includes('recaptcha') ||
        frameUrl.includes('hcaptcha.com')
      ) {
        return {
          detected: true,
          type: 'Embedded Challenge Frame',
          details: `Detected roadblock iframe pointing to: ${frameUrl}`
        };
      }
    }

    return {
      detected: false,
      type: null,
      details: null
    };
  } catch (error) {
    // If scanning DOM throws, log and safely report false so callers can decide
    console.warn(`[CaptchaDetector] Warning during captcha scan: ${error.message}`);
    return {
      detected: false,
      type: null,
      details: `Detection check error: ${error.message}`
    };
  }
}
