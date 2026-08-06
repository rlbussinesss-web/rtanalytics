import { useEffect, useRef, useState } from "react";

export interface LiveEvent {
  eventId: string;
  eventType: string;
  siteId: string;
  sessionId: string;
  visitorId: string;
  path: string;
  timestamp: number;
  payload?: Record<string, unknown>;
}

import { WS_BASE_URL, getToken } from "./token";

const MAX_EVENTS_IN_LIST = 200;

interface UseLiveEventsResult {
  events: LiveEvent[];
  connected: boolean;
}

/**
 * Subscribes to the dashboard-api /live/:siteId WebSocket and keeps a
 * capped, newest-first list of received events in React state. No polling:
 * the list only updates when the server pushes a message.
 */
export function useLiveEvents(siteId: string): UseLiveEventsResult {
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      const token = encodeURIComponent(getToken() ?? "");
      const ws = new WebSocket(`${WS_BASE_URL}/live/${siteId}?token=${token}`);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!cancelled) setConnected(true);
      };

      ws.onmessage = (msg) => {
        try {
          const event = JSON.parse(msg.data) as LiveEvent;
          setEvents((prev) => [event, ...prev].slice(0, MAX_EVENTS_IN_LIST));
        } catch {
          // ignore malformed frames
        }
      };

      ws.onclose = () => {
        if (cancelled) return;
        setConnected(false);
        reconnectTimer = setTimeout(connect, 2000);
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, [siteId]);

  return { events, connected };
}
