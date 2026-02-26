import { chromium } from 'playwright-extra';
import stealthPlugin from 'puppeteer-extra-plugin-stealth';
import { ScrapedData } from '../types';
import { loadCookiesForUrl, isTikTokUrl } from '../utils/cookies';

// Apply stealth plugin to Playwright (via playwright-extra)
chromium.use(stealthPlugin());

const USER_AGENT = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

/** Convertit les cookies parsés en format Playwright (domain requis pour addCookies). */
function toPlaywrightCookies(
  cookies: Array<{ name: string; value: string; domain: string; path: string; expires?: number; secure?: boolean }>,
  url: string
) {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname;
    return cookies
      .filter((c) => hostname.endsWith(c.domain.replace(/^\./, '')) || c.domain === `.${hostname}` || c.domain === hostname)
      .map((c) => ({
        name: c.name,
        value: c.value,
        domain: c.domain.startsWith('.') ? c.domain : `.${c.domain}`,
        path: c.path || '/',
        expires: c.expires,
        secure: c.secure ?? true,
      }));
  } catch {
    return [];
  }
}

export class ScraperService {
  async scrapeUrl(url: string): Promise<ScrapedData> {
    console.log(`[Scraper] Starting scrape for: ${url}`);
    const platform = isTikTokUrl(url) ? 'TikTok' : 'Instagram';

    const browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    try {
      const context = await browser.newContext({
        userAgent: USER_AGENT,
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
        locale: 'fr-FR',
        timezoneId: 'Europe/Paris',
      });

      const rawCookies = loadCookiesForUrl(url);
      const playwrightCookies = toPlaywrightCookies(rawCookies, url);
      if (playwrightCookies.length > 0) {
        await context.addCookies(playwrightCookies);
        console.log(`[Scraper] Loaded ${playwrightCookies.length} cookies for ${platform}`);
      } else {
        console.log(`[Scraper] No cookies for ${platform} - auth wall may block description`);
      }

      const page = await context.newPage();

      // Navigate
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
      
      // Wait for initial load
      try {
        await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      } catch (e) {}

      // --- 1. AGGRESSIVE LOGIN MODAL REMOVAL ---
      const removeModals = async () => {
        await page.evaluate(() => {
          const selectors = [
            '[role="dialog"]', 
            '[role="presentation"]', 
            'div[class*="Backdrop"]', 
            'div[class*="Overlay"]',
            'div[role="dialog"] > div > div > div > div'
          ];
          
          selectors.forEach(sel => {
            document.querySelectorAll(sel).forEach(el => {
              if (el.textContent?.toLowerCase().includes('log in') || 
                  el.textContent?.toLowerCase().includes('sign up') ||
                  el.textContent?.toLowerCase().includes('connectez-vous') ||
                  el.clientHeight > 0) {
                 el.remove();
              }
            });
          });
          document.body.style.overflow = 'auto';
        });
      };

      await removeModals();

      // --- 2. EXPAND CAPTION (Instagram "Plus", TikTok "See more", etc.) ---
      try {
        console.log('[Scraper] Expanding caption...');
        const moreButtons = await page.getByRole('button', { name: /more|plus|suite|see more|voir plus|expand|afficher/i }).all();
        for (const btn of moreButtons) {
          if (await btn.isVisible()) {
            await btn.click({ timeout: 1000 }).catch(() => {});
            await page.waitForTimeout(300);
          }
        }
        const seeMoreLinks = await page.getByText(/see more|voir plus|more|plus/i).all();
        for (const el of seeMoreLinks.slice(0, 3)) {
          if (await el.isVisible()) {
            await el.click({ timeout: 500 }).catch(() => {});
            await page.waitForTimeout(300);
          }
        }
      } catch (e) {}

      // --- 3. SCROLL & CAPTURE COMMENTS (Instagram/TikTok) ---
      console.log('[Scraper] Scrolling for comments...');
      try {
        const viewCommentsBtn = page.getByText(/View all.*comments|Voir les.*commentaires|comments?/i);
        if (await viewCommentsBtn.first().isVisible().catch(() => false)) {
          await viewCommentsBtn.first().click({ timeout: 2000 }).catch(() => {});
          await page.waitForTimeout(1000);
        }
      } catch (e) {}

      let comments: string[] = [];
      
      for (let i = 0; i < 3; i++) {
        await page.mouse.wheel(0, 800);
        await page.waitForTimeout(1500);
        await removeModals();
        
        const newComments = await page.evaluate(() => {
          const commentElements = document.querySelectorAll('ul li, div[role="button"] + div'); 
          return Array.from(commentElements)
            .map(el => el.textContent || '')
            .filter(text => text.length > 10 && text.length < 500)
            .filter(text => !text.includes('Reply') && !text.includes('View all'));
        });
        
        comments = [...comments, ...newComments];
      }
      comments = [...new Set(comments)].slice(0, 20);
      console.log(`[Scraper] Found ${comments.length} comments.`);

      // --- 4. DATA EXTRACTION ---
      const jsonLd = await page.evaluate(() => {
        const scripts = document.querySelectorAll('script[type="application/ld+json"]');
        return Array.from(scripts).map(s => s.textContent).join('\n');
      });

      const metaDescription = await page.evaluate(() => {
        return document.querySelector('meta[name="description"]')?.getAttribute('content') || '';
      });

      const visibleText = await page.evaluate(() => document.body.innerText);

      // Extract full description: recipe-like blocks + longest substantial text (Instagram & TikTok)
      const fullDescription = await page.evaluate(() => {
        const RECIPE_KEYWORDS = /ingr[eé]dients?|recette|recipe|steps?|étapes?|pr[eé]paration|cuisson|min|sec|temps|servings?|personnes?/i;
        const allEls = Array.from(document.querySelectorAll('span, div, p, h1, h2, li, section'));
        const texts = allEls
          .map((el) => (el as HTMLElement).innerText?.trim() || '')
          .filter((t) => t.length >= 30 && t.length <= 15000);
        const unique = [...new Set(texts)];
        const recipeLike = unique.filter((t) => RECIPE_KEYWORDS.test(t)).sort((a, b) => b.length - a.length);
        const longest = unique.sort((a, b) => b.length - a.length);
        const chosen = recipeLike[0] || longest[0] || '';
        const h1 = document.querySelector('h1') as HTMLElement | null;
        const h1Text = h1?.innerText?.trim() || '';
        const parts = [chosen, h1Text].filter(Boolean);
        return [...new Set(parts)].join('\n\n');
      });

      const text = `
DESCRIPTION_FULL (caption/description complète):
${fullDescription || visibleText}

META_DESCRIPTION:
${metaDescription}

JSON_LD:
${jsonLd}

FULL_VISIBLE_BODY (tout le texte de la page):
${visibleText}
      `;

      // Take screenshot
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(500);
      const buffer = await page.screenshot({ fullPage: false, type: 'jpeg', quality: 70 });
      const screenshotBase64 = buffer.toString('base64');
      const title = await page.title();

      console.log(`[Scraper] Successfully scraped ${url}`);
      console.log(`[Scraper] Extracted data:`, {
        textLength: text.length,
        descriptionLength: fullDescription.length,
        metaDescriptionLength: metaDescription.length,
        jsonLdLength: jsonLd.length,
        visibleTextLength: visibleText.length,
        commentsCount: comments.length,
        title: title,
      });
      
      return {
        text,
        comments,
        screenshotBase64,
        url,
        title
      };

    } catch (error) {
      console.error('[Scraper] Error scraping URL:', error);
      throw error;
    } finally {
      // Force cleanup
      if (browser) {
          try {
              await browser.close();
          } catch(e) {
              // Ignore close errors
          }
      }
    }
  }
}
