import request from 'supertest';
import { beforeEach } from 'vitest';
import { createApp } from '../src/app';
import { createSession, SESSION_COOKIE } from '../src/auth';
import type { Config } from '../src/config';
import { prisma } from '../src/db';

export const testConfig: Config = {
  publicUrl: 'http://localhost:2210',
  secureCookies: false,
  devLogin: false,
  github: { clientId: 'id', clientSecret: 'secret', org: 'UW-VexU' },
};

export const app = createApp(testConfig);

let nextGithubId = 1;

export async function signIn(login = 'connor') {
  nextGithubId += 1;
  const user = await prisma.user.create({ data: { githubId: nextGithubId, login } });
  const cookie = `${SESSION_COOKIE}=${await createSession(user.id)}`;
  const call = (method: 'get' | 'post' | 'patch' | 'delete', path: string, body?: object) => {
    const pending = request(app)[method](path).set('Cookie', cookie);
    return body ? pending.send(body) : pending;
  };
  return {
    user,
    get: (path: string) => call('get', path),
    post: (path: string, body: object = {}) => call('post', path, body),
    patch: (path: string, body: object) => call('patch', path, body),
    delete: (path: string) => call('delete', path),
  };
}

export type Client = Awaited<ReturnType<typeof signIn>>;

export const OPAMP = { partNumber: 'LM323M-ND', description: 'IC OPAMP GP 4 CIRCUIT 14SOIC' };

/** Adds a bag through the API and returns its id. */
export async function addBag(client: Client, quantity: number, extra: object = {}): Promise<{ bagId: string; partId: string }> {
  const response = await client.post('/api/intake', { ...OPAMP, quantity, ...extra });
  if (response.status !== 201) throw new Error(`intake failed: ${JSON.stringify(response.body)}`);
  return { bagId: response.body.bagId, partId: response.body.part.id };
}

export async function bagQuantity(bagId: string) {
  return (await prisma.bag.findUniqueOrThrow({ where: { id: bagId } })).quantity;
}

beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE "StockEvent", "Bag", "Part", "Box", "Session", "OAuthState", "User" CASCADE',
  );
});
