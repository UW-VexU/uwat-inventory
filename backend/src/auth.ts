import { createHash, randomBytes } from 'node:crypto';
import type { User } from '@prisma/client';
import { Router, type Request, type RequestHandler, type Response } from 'express';
import { z } from 'zod';
import type { Config } from './config';
import { prisma } from './db';
import { ApiError, parse } from './http';

declare module 'express-serve-static-core' {
  interface Request {
    user?: User;
  }
}

export const SESSION_COOKIE = 'uwat_inventory_session';
const SESSION_MS = 90 * 24 * 60 * 60 * 1000;
const STATE_MS = 10 * 60 * 1000;
const REFRESH_AFTER_MS = 24 * 60 * 60 * 1000;

const hash = (token: string) => createHash('sha256').update(token).digest('hex');
const newToken = () => randomBytes(32).toString('base64url');

export async function createSession(userId: string): Promise<string> {
  const token = newToken();
  await prisma.session.create({
    data: { tokenHash: hash(token), userId, expiresAt: new Date(Date.now() + SESSION_MS) },
  });
  return token;
}

async function userForToken(token: string): Promise<User | null> {
  const session = await prisma.session.findUnique({ where: { tokenHash: hash(token) }, include: { user: true } });
  if (!session || session.expiresAt.getTime() <= Date.now()) return null;

  // Keeps people signed in while they use it, without a write on every request.
  if (Date.now() - session.lastUsedAt.getTime() > REFRESH_AFTER_MS) {
    await prisma.session.update({
      where: { id: session.id },
      data: { lastUsedAt: new Date(), expiresAt: new Date(Date.now() + SESSION_MS) },
    });
  }
  return session.user;
}

/** The website signs in with a cookie, and the phone app with a bearer token. */
function bearerToken(req: Request): string | null {
  const header = req.get('authorization');
  return header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;
}

function sessionToken(req: Request): string | null {
  const cookie: unknown = req.cookies?.[SESSION_COOKIE];
  return bearerToken(req) ?? (typeof cookie === 'string' ? cookie : null);
}

export function requireUser(config: Config): RequestHandler {
  return async (req, _res, next) => {
    const token = sessionToken(req);
    const user = token ? await userForToken(token) : null;
    if (!user) throw new ApiError(401, 'unauthenticated', 'Sign in to continue.');

    // Only cookies are sent by browsers on their own, so only they need this check.
    const origin = req.get('origin');
    if (!bearerToken(req) && !['GET', 'HEAD'].includes(req.method) && origin && origin !== config.publicUrl) {
      throw new ApiError(403, 'bad_origin', 'This request came from another site.');
    }
    req.user = user;
    next();
  };
}

function setSessionCookie(res: Response, token: string, config: Config) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.secureCookies,
    maxAge: SESSION_MS,
    path: '/',
  });
}

interface GitHubProfile {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string | null;
}

async function githubJson<T>(path: string, accessToken: string): Promise<{ status: number; body: T }> {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'uwat-inventory',
    },
  });
  return { status: response.status, body: (await response.json()) as T };
}

async function exchangeCode(code: string, github: NonNullable<Config['github']>, redirectUri: string) {
  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: github.clientId,
      client_secret: github.clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  });
  const body = (await response.json()) as { access_token?: string };
  return body.access_token ?? null;
}

async function consumeState(state: string): Promise<boolean> {
  const stateHash = hash(state);
  const { count } = await prisma.oAuthState.deleteMany({ where: { stateHash, expiresAt: { gt: new Date() } } });
  return count === 1;
}

export function authRoutes(config: Config): Router {
  const router = Router();
  const callbackUrl = `${config.publicUrl}/api/auth/github/callback`;
  const backToLogin = (res: Response, error: string) => res.redirect(`${config.publicUrl}/login?error=${error}`);

  router.get('/config', (_req, res) => {
    res.json({ github: config.github !== null, dev: config.devLogin });
  });

  router.get('/me', requireUser(config), (req, res) => {
    const { id, login, name, avatarUrl } = req.user as User;
    res.json({ user: { id, login, name, avatarUrl } });
  });

  router.get('/github', async (_req, res) => {
    if (!config.github) throw new ApiError(503, 'not_configured', "GitHub sign-in isn't set up on this server.");
    const state = newToken();
    await prisma.oAuthState.deleteMany({ where: { expiresAt: { lte: new Date() } } });
    await prisma.oAuthState.create({
      data: { stateHash: hash(state), expiresAt: new Date(Date.now() + STATE_MS) },
    });
    const params = new URLSearchParams({
      client_id: config.github.clientId,
      redirect_uri: callbackUrl,
      scope: 'read:org',
      state,
    });
    res.redirect(`https://github.com/login/oauth/authorize?${params}`);
  });

  router.get('/github/callback', async (req, res) => {
    const github = config.github;
    if (!github) throw new ApiError(503, 'not_configured', "GitHub sign-in isn't set up on this server.");

    const { code, state } = req.query;
    if (typeof state !== 'string' || !(await consumeState(state))) return backToLogin(res, 'expired');
    if (typeof code !== 'string') return backToLogin(res, 'denied');

    const accessToken = await exchangeCode(code, github, callbackUrl);
    if (!accessToken) return backToLogin(res, 'github');

    const profile = await githubJson<GitHubProfile>('/user', accessToken);
    if (profile.status !== 200) return backToLogin(res, 'github');

    const membership = await githubJson<{ state?: string }>(`/user/memberships/orgs/${github.org}`, accessToken);
    if (membership.status !== 200 || membership.body.state !== 'active') return backToLogin(res, 'not_member');

    const { id, login, name, avatar_url: avatarUrl } = profile.body;
    const user = await prisma.user.upsert({
      where: { githubId: id },
      create: { githubId: id, login, name, avatarUrl },
      update: { login, name, avatarUrl },
    });
    setSessionCookie(res, await createSession(user.id), config);
    res.redirect(`${config.publicUrl}/`);
  });

  router.post('/logout', async (req, res) => {
    const token = sessionToken(req);
    if (token) await prisma.session.deleteMany({ where: { tokenHash: hash(token) } });
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.json({ ok: true });
  });

  if (config.devLogin) {
    const devBody = z.object({ login: z.string().trim().min(1).max(39) });
    router.post('/dev', async (req, res) => {
      const { login } = parse(devBody, req.body);
      const githubId = -Math.abs(Number.parseInt(hash(login).slice(0, 7), 16));
      const user = await prisma.user.upsert({
        where: { githubId },
        create: { githubId, login, name: login },
        update: {},
      });
      const token = await createSession(user.id);
      setSessionCookie(res, token, config);
      res.json({ token, user: { id: user.id, login: user.login, name: user.name, avatarUrl: user.avatarUrl } });
    });
  }

  return router;
}
