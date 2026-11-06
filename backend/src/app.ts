import cookieParser from 'cookie-parser';
import express from 'express';
import { authRoutes, requireUser } from './auth';
import { boardFileRoutes, boardRoutes } from './boards';
import type { Config } from './config';
import { ApiError, errorHandler } from './http';
import { importRoutes } from './importer';
import { inventoryRoutes } from './inventory';

export function createApp(config: Config) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(cookieParser());
  // Big uploads check who's asking first, so these sit ahead of the small default body limit.
  app.use('/api', boardFileRoutes(config));
  app.use(express.json({ limit: '4mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });
  app.use('/api/auth', authRoutes(config));
  app.use('/api', requireUser(config), inventoryRoutes(), importRoutes(), boardRoutes());
  app.use('/api', (_req, _res) => {
    throw new ApiError(404, 'not_found', 'No such endpoint.');
  });
  app.use(errorHandler);
  return app;
}
