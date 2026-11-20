import type { AddressInfo } from 'node:net';
import type { LiveMessage } from '@uwat/shared';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { createSession } from '../src/auth';
import { subscribe } from '../src/live';
import { app, OPAMP, signIn } from './helpers';

let stop: (() => void) | null = null;
afterEach(() => stop?.());

function listen(): LiveMessage[] {
  const heard: LiveMessage[] = [];
  stop = subscribe((message) => heard.push(message));
  return heard;
}

/** Messages go out once the response has finished, a moment after the client sees it. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

describe('live updates', () => {
  it('announces a bag added on the phone, with what it was', async () => {
    const client = await signIn('connor');
    const token = await createSession(client.user.id);
    const heard = listen();

    await request(app)
      .post('/api/intake')
      .set('Authorization', `Bearer ${token}`)
      .send({ partNumber: '296-29034-1-ND', mfrPartNumber: 'INA226AIDGSR', quantity: 12 });
    await settle();

    expect(heard).toEqual([
      { type: 'intake', partId: expect.any(String), name: 'INA226AIDGSR', quantity: 12, by: 'connor', source: 'phone' },
    ]);
  });

  it('marks bags added on the website as such, and announces other changes plainly', async () => {
    const client = await signIn();
    const heard = listen();

    const added = await client.post('/api/intake', { ...OPAMP, quantity: 5 });
    await client.post(`/api/bags/${added.body.bagId}/take`, { amount: 2 });
    await settle();

    expect(heard).toMatchObject([{ type: 'intake', source: 'web' }, { type: 'change' }]);
  });

  it('stays quiet about reads and about changes that failed', async () => {
    const client = await signIn();
    const heard = listen();

    await client.get('/api/inventory');
    await client.post('/api/intake', { quantity: 5 });
    await settle();

    expect(heard).toEqual([]);
  });

  it('streams to signed-in pages', async () => {
    const client = await signIn();
    const token = await createSession(client.user.id);
    expect((await request(app).get('/api/live')).status).toBe(401);

    const server = app.listen(0);
    const { port } = server.address() as AddressInfo;
    const controller = new AbortController();
    try {
      const response = await fetch(`http://localhost:${port}/api/live`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      expect(response.headers.get('content-type')).toBe('text/event-stream');
      const reader = response.body!.getReader();
      await reader.read();

      await client.post('/api/boxes', { code: 'B-01' });
      let text = '';
      while (!text.includes('data:')) text += new TextDecoder().decode((await reader.read()).value);
      expect(text).toContain('data: {"type":"change"}');
    } finally {
      controller.abort();
      server.close();
    }
  });
});
