import { afterEach, describe, expect, it, vi } from 'vitest';

async function webRuntime() {
  vi.resetModules();
  vi.stubEnv('MODE', 'web');
  return import('../runtime');
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('Web API transport', () => {
  it('shares session initialization across requests and sends command arguments as JSON', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockImplementation(async () => Response.json({ code: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { invoke } = await webRuntime();

    await Promise.all([invoke('get_index_v8_feeds', { page: 1 }), invoke('list_accounts')]);

    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      '/api/session', '/api/command/get_index_v8_feeds', '/api/command/list_accounts',
    ]);
    expect(fetchMock.mock.calls[1]?.[1]?.body).toBe('{"page":1}');
  });

  it('sends binary parts as a multipart upload after renewing an expired session', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(Response.json({ code: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { invoke } = await webRuntime();

    await expect(invoke('change_avatar', { fileName: 'avatar.png', imageBytes: new Uint8Array([1, 2, 3]) }))
      .resolves.toEqual({ code: 200 });

    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      '/api/session', '/api/upload/change_avatar', '/api/session', '/api/upload/change_avatar',
    ]);
    const body = fetchMock.mock.calls[3]?.[1]?.body as FormData;
    expect(body.get('metadata')).toBe('{"fileName":"avatar.png"}');
    expect(body.get('imageBytes')).toMatchObject({ size: 3 });
  });
});
