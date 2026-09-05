import { describe, it, expect } from "vitest";
import { classifyBot } from "./bots.js";

/**
 * Bot classification decides whether a visit is counted at all, so both
 * directions matter: missing a crawler inflates every metric, and flagging a
 * real person silently deletes them from the reports. The false-positive cases
 * below are the ones that would quietly corrupt the numbers.
 */
describe("classifyBot", () => {
  const REAL_BROWSERS = [
    // Desktop Chrome on Windows
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36",
    // iPhone Safari
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Mobile/15E148 Safari/604.1",
    // Android Chrome
    "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Mobile Safari/537.36",
    // Samsung Internet
    "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/30.0 Chrome/143.0.0.0 Mobile Safari/537.36",
    // Firefox on macOS
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:130.0) Gecko/20100101 Firefox/130.0",
  ];

  it.each(REAL_BROWSERS)("treats a real browser as human: %s", (ua) => {
    expect(classifyBot(ua).isBot).toBe(false);
  });

  const BOTS: [string, string][] = [
    ["Googlebot", "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"],
    ["Bingbot", "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)"],
    ["facebook", "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)"],
    ["whatsapp", "WhatsApp/2.23.20.0"],
    ["headless", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 HeadlessChrome/120.0.0.0 Safari/537.36"],
    ["curl", "curl/8.4.0"],
    ["python", "python-requests/2.31.0"],
    ["uptime", "Mozilla/5.0 (compatible; UptimeRobot/2.0; http://www.uptimerobot.com/)"],
    ["ahrefs", "Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)"],
  ];

  it.each(BOTS)("flags %s as a bot", (_name, ua) => {
    expect(classifyBot(ua).isBot).toBe(true);
  });

  it("reports why it flagged, for auditing false positives", () => {
    const verdict = classifyBot("curl/8.4.0");
    expect(verdict.isBot).toBe(true);
    expect(verdict.reason).toBe("ua:curl/");
  });

  it("trusts the browser admitting automation even when the UA looks human", () => {
    const humanLooking = REAL_BROWSERS[0]!;
    expect(classifyBot(humanLooking).isBot).toBe(false);
    expect(classifyBot(humanLooking, { webdriver: true })).toEqual({
      isBot: true,
      reason: "webdriver",
    });
  });

  it("does not treat a missing user agent as a bot", () => {
    // Privacy browsers and some in-app webviews strip the UA; those are people.
    expect(classifyBot(undefined).isBot).toBe(false);
    expect(classifyBot("").isBot).toBe(false);
  });

  it("matches case-insensitively", () => {
    expect(classifyBot("GoogleBot/2.1").isBot).toBe(true);
    expect(classifyBot("CURL/8.4.0").isBot).toBe(true);
  });
});
