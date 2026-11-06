import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { SESSION_COOKIE } from '../src/auth';
import { loadConfig } from '../src/config';
import { prisma } from '../src/db';
import { app, signIn, testConfig } from './helpers';

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubGitHub({ membership, status = 200 }: { membership: object; status?: number }) {
  const stub = vi.fn(async (url: string | URL) => {
    const target = String(url);
    if (target.includes('/login/oauth/access_token')) return Response.json({ access_token: 'gh-token' });
    if (target.endsWith('/user')) {
      return Response.json({ id: 42, login: 'connorxtan', name: 'Connor', avatar_url: 'https://a/b.png' });
    }
    if (target.includes('/user/memberships/orgs/UW-VexU')) return Response.json(membership, { status });
    throw new Error(`Unexpected fetch: ${target}`);
  });
  vi.stubGlobal('fetch', stub);
  return stub;
}

async function startSignIn() {
  const response = await request(app).get('/api/auth/github');
  return new URL(response.headers.location as string).searchParams.get('state') as string;
}

describe('access', () => {
  it('turns away anyone not signed in', async () => {
    for (const path of ['/api/inventory', '/api/events', '/api/export.csv', '/api/auth/me']) {
      expect((await request(app).get(path)).status).toBe(401);
    }
    expect((await request(app).post('/api/intake').send({ quantity: 1 })).status).toBe(401);
  });

  it('rejects made-up and expired sessions', async () => {
    const fake = await request(app).get('/api/inventory').set('Cookie', `${SESSION_COOKIE}=made-up`);
    expect(fake.status).toBe(401);

    const client = await signIn();
    await prisma.session.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await client.get('/api/inventory')).status).toBe(401);
  });

  it('never stores the session token itself', async () => {
    const client = await signIn();
    const cookie = (await client.get('/api/auth/me')).request.get('Cookie') as unknown as string;
    const session = await prisma.session.findFirstOrThrow();
    expect(cookie).not.toContain(session.tokenHash);
  });

  it('refuses changes sent from another site', async () => {
    const client = await signIn();
    const response = await client.post('/api/boxes', {}).set('Origin', 'https://evil.example');
    expect(response.status).toBe(403);
    expect(await prisma.box.count()).toBe(0);
  });

  it('accepts changes from our own site', async () => {
    const client = await signIn();
    const response = await client.post('/api/boxes', {}).set('Origin', testConfig.publicUrl);
    expect(response.status).toBe(201);
  });

  it('signs out for real', async () => {
    const client = await signIn();
    await client.post('/api/auth/logout');
    expect((await client.get('/api/auth/me')).status).toBe(401);
  });
});

describe('GitHub sign-in', () => {
  it('lets org members in', async () => {
    stubGitHub({ membership: { state: 'active' } });
    const state = await startSignIn();

    const response = await request(app).get(`/api/auth/github/callback?code=abc&state=${state}`);

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe(`${testConfig.publicUrl}/`);
    expect(String(response.headers['set-cookie'])).toContain('HttpOnly');
    expect(await prisma.user.findFirstOrThrow()).toMatchObject({ githubId: 42, login: 'connorxtan' });
  });

  it('keeps out people who are not in the org', async () => {
    stubGitHub({ membership: { message: 'Not Found' }, status: 404 });
    const state = await startSignIn();

    const response = await request(app).get(`/api/auth/github/callback?code=abc&state=${state}`);

    expect(response.headers.location).toContain('error=not_member');
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(await prisma.session.count()).toBe(0);
  });

  it('keeps out people with a pending org invite', async () => {
    stubGitHub({ membership: { state: 'pending' } });
    const state = await startSignIn();
    const response = await request(app).get(`/api/auth/github/callback?code=abc&state=${state}`);
    expect(response.headers.location).toContain('error=not_member');
  });

  it('rejects a forged state and a reused one', async () => {
    stubGitHub({ membership: { state: 'active' } });
    const forged = await request(app).get('/api/auth/github/callback?code=abc&state=forged');
    expect(forged.headers.location).toContain('error=expired');

    const state = await startSignIn();
    await request(app).get(`/api/auth/github/callback?code=abc&state=${state}`);
    const reused = await request(app).get(`/api/auth/github/callback?code=abc&state=${state}`);
    expect(reused.headers.location).toContain('error=expired');
  });

  it('handles someone declining on GitHub', async () => {
    const state = await startSignIn();
    const response = await request(app).get(`/api/auth/github/callback?error=access_denied&state=${state}`);
    expect(response.headers.location).toContain('error=denied');
  });
});

describe('bearer tokens, for the phone app', () => {
  async function devToken() {
    const devApp = createApp({ ...testConfig, devLogin: true });
    const { body } = await request(devApp).post('/api/auth/dev').send({ login: 'phone' });
    return { devApp, token: body.token as string };
  }

  it('signs in with the token from dev sign-in', async () => {
    const { devApp, token } = await devToken();
    const response = await request(devApp).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(200);
    expect(response.body.user.login).toBe('phone');
  });

  it('turns away a made-up token', async () => {
    const response = await request(app).get('/api/inventory').set('Authorization', 'Bearer made-up');
    expect(response.status).toBe(401);
  });

  it("doesn't apply the cross-site check, which only protects cookies", async () => {
    const { devApp, token } = await devToken();
    const response = await request(devApp)
      .post('/api/boxes')
      .set('Authorization', `Bearer ${token}`)
      .set('Origin', 'https://somewhere.example')
      .send({});
    expect(response.status).toBe(201);
  });

  it('signs out for real', async () => {
    const { devApp, token } = await devToken();
    await request(devApp).post('/api/auth/logout').set('Authorization', `Bearer ${token}`);
    const response = await request(devApp).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(401);
  });

  it('only has the scan log when dev sign-in is on', async () => {
    const { devApp, token } = await devToken();
    const auth = `Bearer ${token}`;
    expect((await request(devApp).post('/api/debug/scan').set('Authorization', auth).send({ raw: 'x' })).status).toBe(200);
    expect((await request(app).post('/api/debug/scan').set('Authorization', auth).send({ raw: 'x' })).status).toBe(404);
  });
});

describe('session cookie', () => {
  it('is Secure on HTTPS and left off on plain HTTP, where browsers would drop it', () => {
    expect(loadConfig({ PUBLIC_URL: 'https://inventory.uwvexu.ca' }).secureCookies).toBe(true);
    expect(loadConfig({ NODE_ENV: 'production', PUBLIC_URL: 'http://10.0.0.5:2210' }).secureCookies).toBe(false);
  });

  it('carries the Secure flag when the site is on HTTPS', async () => {
    const secureApp = createApp({ ...testConfig, devLogin: true, secureCookies: true });
    const response = await request(secureApp).post('/api/auth/dev').send({ login: 'tester' });
    expect(String(response.headers['set-cookie'])).toContain('Secure');
  });
});

describe('dev sign-in', () => {
  it('gets nobody in unless turned on', async () => {
    const response = await request(app).post('/api/auth/dev').send({ login: 'x' });
    expect(response.status).toBe(401);
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(await prisma.user.count()).toBe(0);
  });

  it('can never be turned on in production', () => {
    expect(loadConfig({ NODE_ENV: 'production', DEV_LOGIN: '1' }).devLogin).toBe(false);
    expect(loadConfig({ NODE_ENV: 'development', DEV_LOGIN: '1' }).devLogin).toBe(true);
  });

  it('signs in when turned on', async () => {
    const devApp = createApp({ ...testConfig, devLogin: true });
    const response = await request(devApp).post('/api/auth/dev').send({ login: 'tester' });
    expect(response.status).toBe(200);
    expect(response.body.user.login).toBe('tester');
  });
});
