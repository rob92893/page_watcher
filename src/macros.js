/**
 * Browser Automation Macro Registry
 * 
 * Maps target URLs to custom wait-and-act browser automation macros.
 * Each macro defines:
 * 1. How to detect state changes (e.g., RSVP slot open, inventory restocked).
 * 2. Automated actions to fill forms and submit.
 * 3. Success verification.
 */

import { detectCaptcha } from './captchaDetector.js';
import { maskSensitive } from './utils.js';

/**
 * Custom Error class to signal intentional abortion due to bot challenges
 */
export class RoadblockError extends Error {
  constructor(message, details = null) {
    super(message);
    this.name = 'RoadblockError';
    this.details = details;
  }
}

/**
 * Macro: RSVP / Registration Wait-and-Act
 * 
 * Monitors an event registration or appointment slot page.
 * If open, fills out user details and submits.
 */
export async function rsvpMacro({ page, targetUrl }) {
  console.log(`[rsvpMacro] Starting monitor on: ${targetUrl}`);

  // 1. Proactive Captcha Check after initial render
  const captchaCheck = await detectCaptcha(page);
  if (captchaCheck.detected) {
    throw new RoadblockError(
      `Captcha detected immediately on load (${captchaCheck.type})`,
      captchaCheck.details
    );
  }

  // 2. Identify slot availability
  // Check for common open RSVP indicators vs disabled indicators
  const rsvpButtonSelector = 'button:has-text("RSVP"), button:has-text("Register"), button:has-text("Book"), button:has-text("Buy"), button:has-text("Add to Cart"), button:has-text("Tickets"), a:has-text("RSVP"), a:has-text("Register"), a:has-text("Tickets")';
  const soldOutSelector = ':has-text("Sold Out"), :has-text("No Slots Available"), :has-text("Waitlist Only"), :has-text("Out of Stock"), button[disabled]';
  const soldOutIndicator = await page.$(soldOutSelector);

  if (soldOutIndicator) {
    const textContent = await soldOutIndicator.textContent().catch(() => 'Unavailable');
    console.log(`[rsvpMacro] Slot is currently closed/full (${textContent.trim()}). Standing by.`);
    return {
      triggered: false,
      actionSummary: `Slot currently unavailable (${textContent.trim()}). No action needed.`
    };
  }

  // The page NO LONGER shows "Sold Out"!
  console.log('[rsvpMacro] 🚨 State change detected! Page no longer shows Sold Out!');

  // Check for active action button
  console.log('[rsvpMacro] Checking for active RSVP / Buy button...');
  const rsvpButton = page.locator(rsvpButtonSelector).first();
  const isAvailable = await rsvpButton.isVisible({ timeout: 5000 }).catch(() => false);

  if (!isAvailable) {
    // Alert user immediately via fallback system so they can act manually
    throw new RoadblockError(
      'Restock / Open Slot Detected: Page is no longer Sold Out!',
      'Page state changed from Sold Out to active, but an automated form button was not recognized. Please open the link and complete registration manually.'
    );
  }

  // Slot is detected as open and button is visible! Trigger macro actions.
  console.log('[rsvpMacro] Slot is OPEN! Initiating registration macro...');

  // Click the RSVP / Register trigger
  await rsvpButton.click();
  await page.waitForTimeout(1000); // Allow modal or form transition

  // Check again for Captchas that may pop up after interaction
  const postClickCaptcha = await detectCaptcha(page);
  if (postClickCaptcha.detected) {
    throw new RoadblockError(
      `Captcha triggered after clicking RSVP button (${postClickCaptcha.type})`,
      postClickCaptcha.details
    );
  }

  // 3. Fill out Registration Form Inputs using Environment Variables
  const name = process.env.REGISTRATION_NAME || 'Automated Guest';
  const email = process.env.REGISTRATION_EMAIL || 'automated.guest@example.com';
  const phone = process.env.REGISTRATION_PHONE || '5551234567';

  console.log(`[rsvpMacro] Filling form: Name="${maskSensitive(name)}", Email="${maskSensitive(email)}"`);

  // Fill Name (matches name, full_name, fullname, firstName)
  const nameInput = page.locator('input[name*="name" i], input[id*="name" i], input[placeholder*="name" i]').first();
  if (await nameInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await nameInput.fill(name);
  }

  // Fill Email
  const emailInput = page.locator('input[type="email"], input[name*="email" i], input[id*="email" i], input[placeholder*="email" i]').first();
  if (await emailInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await emailInput.fill(email);
  }

  // Fill Phone (if present on form)
  const phoneInput = page.locator('input[type="tel"], input[name*="phone" i], input[id*="phone" i], input[placeholder*="phone" i]').first();
  if (await phoneInput.isVisible({ timeout: 2000 }).catch(() => false)) {
    await phoneInput.fill(phone);
  }

  // Final Captcha scan right before submit
  const preSubmitCaptcha = await detectCaptcha(page);
  if (preSubmitCaptcha.detected) {
    throw new RoadblockError(
      `Captcha roadblock detected on registration form (${preSubmitCaptcha.type})`,
      preSubmitCaptcha.details
    );
  }

  // 4. Submit the Form
  console.log('[rsvpMacro] Submitting registration form...');
  const submitButton = page.locator('button[type="submit"], input[type="submit"], button:has-text("Confirm"), button:has-text("Complete RSVP")').first();
  
  if (await submitButton.isVisible({ timeout: 4000 }).catch(() => false)) {
    await submitButton.click();
  } else {
    // If no explicit submit button found, try pressing Enter in the last input field
    await page.keyboard.press('Enter');
  }

  // 5. Verification step: wait for confirmation message or navigation
  await page.waitForTimeout(1000);
  const confirmationSelector = ':has-text("Thank you"), :has-text("Confirmed"), :has-text("Success"), :has-text("Registered"), .confirmation-message';
  const confirmationEl = page.locator(confirmationSelector).first();
  const confirmationText = await confirmationEl.isVisible({ timeout: 5000 }).catch(() => false);

  const actionSummary = confirmationText 
    ? `Successfully registered RSVP for ${maskSensitive(name)} (${maskSensitive(email)}). Confirmed on screen.`
    : `Submitted RSVP form for ${maskSensitive(name)} (${maskSensitive(email)}). Awaiting server confirmation.`;

  console.log(`[rsvpMacro] ✅ Completed: ${actionSummary}`);
  return {
    triggered: true,
    actionSummary
  };
}

/**
 * Macro: Inventory Restock Wait-and-Act
 * 
 * Monitors an e-commerce product page for restock state change and adds to cart.
 */
export async function restockMacro({ page, targetUrl }) {
  console.log(`[restockMacro] Starting restock monitor on: ${targetUrl}`);

  // Proactive Captcha Check
  const captchaCheck = await detectCaptcha(page);
  if (captchaCheck.detected) {
    throw new RoadblockError(
      `Captcha detected on product page (${captchaCheck.type})`,
      captchaCheck.details
    );
  }

  // Restock indicators
  const outOfStockSelector = ':has-text("Out of Stock"), :has-text("Sold Out"), :has-text("Currently Unavailable")';
  const outOfStock = await page.$(outOfStockSelector);
  if (outOfStock) {
    console.log('[restockMacro] Item is currently out of stock. Monitoring...');
    return {
      triggered: false,
      actionSummary: 'Product is still Out of Stock. Standing by.'
    };
  }

  // Look for Add to Cart or Buy Now button
  const addToCartBtn = page.locator('button:has-text("Add to Cart"), button:has-text("Buy Now"), #add-to-cart-button').first();
  const isAvailable = await addToCartBtn.isVisible({ timeout: 5000 }).catch(() => false);

  if (!isAvailable) {
    return {
      triggered: false,
      actionSummary: 'Add to Cart button not yet visible.'
    };
  }

  console.log('[restockMacro] In-stock detected! Clicking Add to Cart...');
  await addToCartBtn.click();
  await page.waitForTimeout(2000);

  const actionSummary = 'Item in stock! Successfully clicked Add to Cart.';
  console.log(`[restockMacro] ✅ ${actionSummary}`);
  return {
    triggered: true,
    actionSummary
  };
}

/**
 * Target URL to Macro Mapping Registry
 * 
 * Add your custom URLs and assign them to an automation macro here.
 */
export const urlMacroRegistry = {
  // Example 1: Event RSVP Target
  'https://example.com/events/summer-rsvp': rsvpMacro,

  // Example 2: Product Restock Target
  'https://example.com/products/limited-edition-item': restockMacro,

  // Example 3: Test fixture page
  'https://example.com/test-slot': rsvpMacro
};

/**
 * Resolves a macro function for a given URL.
 * Supports exact string match or regex/prefix matching.
 * 
 * @param {string} url 
 * @returns {Function|null}
 */
export function getMacroForUrl(url) {
  // 1. Direct exact match
  if (urlMacroRegistry[url]) {
    return urlMacroRegistry[url];
  }

  // 2. Prefix or pattern match
  for (const [key, macro] of Object.entries(urlMacroRegistry)) {
    if (url.startsWith(key) || url.includes(key)) {
      return macro;
    }
  }

  // Default fallback if no specific macro mapped: use rsvpMacro
  return rsvpMacro;
}
