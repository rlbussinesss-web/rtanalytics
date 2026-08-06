/**
 * Entry point for the separately-bundled recorder (dist/recorder.js).
 *
 * Kept out of the main tracker bundle on purpose: rrweb is an order of
 * magnitude larger than the tracker itself, and most visitors are never
 * watched, so most visitors should never download it. Exposing it on
 * `window.rrweb` lets the tracker use it without a module loader.
 */
import { record } from "rrweb";

(window as unknown as {
  rrweb: { record: typeof record; takeFullSnapshot: typeof record.takeFullSnapshot };
}).rrweb = { record, takeFullSnapshot: record.takeFullSnapshot };
