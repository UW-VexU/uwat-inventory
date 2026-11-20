import type { LiveMessage } from '@uwat/shared';
import { Router, type RequestHandler } from 'express';

type Listener = (message: LiveMessage) => void;

const listeners = new Set<Listener>();

/** Proxies and tunnels drop a connection that stays quiet for about a minute. */
const PING_MS = 25_000;

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function broadcast(message: LiveMessage) {
  for (const listener of listeners) listener(message);
}

/**
 * Tells open pages about every change that worked. A route can describe its change in
 * res.locals.live; anything else goes out as a plain "something changed".
 */
export const announceChanges: RequestHandler = (req, res, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !/^\/(auth|debug)\//.test(req.path)) {
    res.on('finish', () => {
      if (res.statusCode < 400) broadcast((res.locals.live as LiveMessage | undefined) ?? { type: 'change' });
    });
  }
  next();
};

export function liveRoutes(): Router {
  const router = Router();

  router.get('/live', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      // no-transform stops compression, which would hold messages back until a buffer fills.
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 3000\n\n');

    const stop = subscribe((message) => res.write(`data: ${JSON.stringify(message)}\n\n`));
    const ping = setInterval(() => res.write(': ping\n\n'), PING_MS);
    req.on('close', () => {
      clearInterval(ping);
      stop();
    });
  });

  return router;
}
