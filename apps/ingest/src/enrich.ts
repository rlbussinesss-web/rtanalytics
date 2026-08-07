import geoip from "geoip-lite";
import { UAParser } from "ua-parser-js";
import type { EnrichedFields } from "@rtanalytics/shared-types";

/**
 * Server-side enrichment: turns the connection's IP and User-Agent into
 * country/city and device/browser/OS.
 *
 * These are derived here, not in the tracker, for two reasons: the browser
 * can't see its own public IP (so geo must be server-side), and doing it on
 * the server keeps the tracker bundle tiny and means we never trust the
 * client for these fields.
 *
 * Both lookups are fully local — geoip-lite ships a GeoLite2 snapshot and
 * ua-parser is pure string parsing — so enrichment adds no network hop and no
 * per-event latency. It is computed once per connection (IP and UA are
 * constant for a socket) rather than per event.
 */

export function enrichFromConnection(ip: string | undefined, userAgent: string | undefined): EnrichedFields {
  return { ...geoFromIp(ip), ...deviceFromUserAgent(userAgent) };
}

function geoFromIp(ip: string | undefined): Pick<EnrichedFields, "country" | "region" | "city"> {
  if (!ip) return {};
  // Strip a possible IPv6-mapped IPv4 prefix (::ffff:1.2.3.4) that geoip rejects.
  const clean = ip.replace(/^::ffff:/, "");
  const found = geoip.lookup(clean);
  if (!found) return {};
  return {
    country: found.country || undefined,
    // `region` is the ISO subdivision code (e.g. "SP", "RJ") — the state the
    // visitor is in, which matters for targeting the buying audience by region.
    region: found.region || undefined,
    city: found.city || undefined,
  };
}

function deviceFromUserAgent(
  userAgent: string | undefined
): Pick<EnrichedFields, "device" | "browser" | "os"> {
  if (!userAgent) return {};
  const parsed = new UAParser(userAgent).getResult();
  return {
    // ua-parser leaves device.type undefined for desktops; normalize that.
    device: parsed.device.type ?? "desktop",
    browser: parsed.browser.name || undefined,
    os: parsed.os.name || undefined,
  };
}
