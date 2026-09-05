/**
 * Bot classification.
 *
 * Crawlers, previewers and automation tools inflate every metric: they load
 * pages, never buy, and drown the numbers a media buyer actually decides on.
 * Classifying them at ingest (rather than filtering in the dashboard) means the
 * judgement is stored once, next to the event, and every consumer agrees.
 *
 * The signals are deliberately conservative — a false positive silently deletes
 * a real visitor from the reports, which is worse than letting a bot through.
 * Only unambiguous evidence counts: self-identifying user agents, known
 * automation runtimes, and the browser admitting it is driven by automation.
 */

/** Substrings that appear in self-identifying crawler/automation user agents. */
const BOT_UA_PATTERNS: readonly string[] = [
  // Generic self-identification — most well-behaved crawlers say so.
  "bot", "crawler", "spider", "crawling",
  // Search / SEO
  "slurp", "duckduckbot", "baiduspider", "yandex", "sogou", "exabot",
  "ia_archiver", "ahrefs", "semrush", "mj12", "dotbot", "petalbot",
  // Social preview fetchers (link unfurling, not real visitors)
  "facebookexternalhit", "facebot", "twitterbot", "linkedinbot", "slackbot",
  "whatsapp", "telegrambot", "discordbot", "embedly", "quora link preview",
  "pinterest", "redditbot", "applebot", "bingpreview", "skypeuripreview",
  // Automation runtimes / headless browsers
  "headlesschrome", "phantomjs", "puppeteer", "playwright", "selenium",
  "webdriver", "cypress", "electron/",
  // Non-browser HTTP clients
  "curl/", "wget/", "python-requests", "python-urllib", "go-http-client",
  "java/", "okhttp", "axios/", "node-fetch", "got/", "libwww-perl",
  "httpclient", "postmanruntime", "insomnia",
  // Monitoring / uptime
  "pingdom", "uptimerobot", "statuscake", "site24x7", "newrelicpinger",
  "datadog", "gtmetrix", "lighthouse", "pagespeed", "chrome-lighthouse",
];

export interface BotSignals {
  /** navigator.webdriver — the browser admitting it is automated. */
  webdriver?: boolean;
}

export interface BotVerdict {
  isBot: boolean;
  /** Short machine-readable reason, useful for auditing false positives. */
  reason?: string;
}

/**
 * Decides whether a connection belongs to a bot.
 *
 * A missing user agent alone is NOT treated as a bot: privacy browsers and
 * some in-app webviews strip it, and those are real people.
 */
export function classifyBot(userAgent: string | undefined, signals: BotSignals = {}): BotVerdict {
  if (signals.webdriver === true) {
    return { isBot: true, reason: "webdriver" };
  }

  if (!userAgent) return { isBot: false };
  const ua = userAgent.toLowerCase();

  for (const pattern of BOT_UA_PATTERNS) {
    if (ua.includes(pattern)) {
      return { isBot: true, reason: `ua:${pattern}` };
    }
  }

  return { isBot: false };
}
