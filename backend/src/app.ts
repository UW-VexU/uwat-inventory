import cookieParser from 'cookie-parser';
import express from 'express';
import { authRoutes, requireUser } from './auth';
import type { Config } from './config';
import { ApiError, errorHandler } from './http';
import { importRoutes } from './importer';
import { inventoryRoutes } from './inventory';

export function createApp(config: Config) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '4mb' }));
  app.use(cookieParser());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });
  app.use('/api/auth', authRoutes(config));
  app.use('/api', requireUser(config), inventoryRoutes(), importRoutes());
  app.use('/api', (_req, _res) => {
    throw new ApiError(404, 'not_found', 'No such endpoint.');
  });
  app.use(errorHandler);
  return app;
}
