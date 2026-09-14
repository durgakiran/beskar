const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');

function consoleHarness(response = { status: 200, type: 'basic' }) {
  let config;
  const requests = [];
  const navigations = [];
  const Scalar = { createApiReference: (_, value) => { config = value; } };
  const html = readFileSync(`${__dirname}/index.html`, 'utf8');
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1];
  vm.runInNewContext(script, {
    Scalar, Request, URL,
    window: { Scalar, location: {
      href: 'https://app.example.com/api/docs', origin: 'https://app.example.com',
      assign: url => navigations.push(url),
    } },
    fetch: async (input, init) => { requests.push({ input, init }); return response; },
  });
  return { send: config.customFetch, requests, navigations, response };
}

test('login navigates and returns to docs without fetching the identity provider', async () => {
  const h = consoleHarness();
  await assert.rejects(h.send(new Request('https://app.example.com/auth/login')), /Opening authentication/);
  assert.equal(h.navigations[0], 'https://app.example.com/auth/login?returnTo=%2Fapi%2Fdocs');
  assert.equal(h.requests.length, 0);
});

test('registration and logout navigate, callback cannot be replayed', async () => {
  for (const path of ['/auth/register', '/auth/logout', '/auth/callback']) {
    const h = consoleHarness();
    await assert.rejects(h.send(path));
    assert.equal(h.requests.length, 0);
    assert.equal(h.navigations.length, path === '/auth/callback' ? 0 : 1);
  }
});

test('API calls preserve method/body/token and include same-origin cookies', async () => {
  const h = consoleHarness();
  const init = { method: 'POST', body: '{"title":"Board"}', headers: { Authorization: 'Bearer test' } };
  assert.equal(await h.send('/api/v2/editor/space/id/whiteboard/create', init), h.response);
  assert.equal(h.requests[0].init.body, init.body);
  assert.equal(h.requests[0].init.method, 'POST');
  assert.equal(h.requests[0].init.headers.Authorization, 'Bearer test');
  assert.equal(h.requests[0].init.credentials, 'same-origin');
  assert.equal(h.requests[0].init.redirect, 'manual');
  assert.equal(h.navigations.length, 0);
});

test('expired-session redirects give guidance without replaying a write', async () => {
  const h = consoleHarness({ status: 0, type: 'opaqueredirect' });
  await assert.rejects(h.send('/api/v2/editor/space/id/whiteboard/create', { method: 'POST' }), /Use Sign in/);
  assert.equal(h.requests.length, 1);
  assert.equal(h.navigations.length, 0);
});
