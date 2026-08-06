import type { WebSocket } from "ws";
import { Redis } from "ioredis";

/**
 * Registry of live tracker connections, plus the control channel that lets a
 * dashboard viewer reach a specific visitor's browser.
 *
 * Live screen viewing is on-demand: the tracker records nothing until someone
 * asks to watch. That request has to travel from the dashboard to whichever
 * ingest instance happens to hold that visitor's socket — which is why it goes
 * over Redis pub/sub rather than an in-process call. Any number of ingest
 * replicas can run; each ignores commands for sessions it doesn't hold.
 */

const CONTROL_CHANNEL = "control";

type Command = { sessionId: string; action: "start-recording" | "stop-recording" };

const sockets = new Map<string, WebSocket>();

export function registerSession(sessionId: string, socket: WebSocket): void {
  sockets.set(sessionId, socket);
}

export function unregisterSession(sessionId: string): void {
  sockets.delete(sessionId);
}

/** Number of tracker connections held by this instance (for /healthz). */
export function connectionCount(): number {
  return sockets.size;
}

export function subscribeToCommands(redisUrl: string, log: (msg: string) => void): Redis {
  const subscriber = new Redis(redisUrl);

  subscriber.subscribe(CONTROL_CHANNEL).catch((err) => {
    log(`failed to subscribe to control channel: ${String(err)}`);
  });

  subscriber.on("message", (_channel: string, raw: string) => {
    let command: Command;
    try {
      command = JSON.parse(raw) as Command;
    } catch {
      return;
    }

    const socket = sockets.get(command.sessionId);
    if (!socket) return; // session lives on another replica, or already gone

    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify({ type: command.action }));
      log(`sent ${command.action} to session ${command.sessionId}`);
    }
  });

  return subscriber;
}
