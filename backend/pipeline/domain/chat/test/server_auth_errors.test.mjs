import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

async function setup(token, detail) {
  let clears = 0;
  const state = { authToken: token, clearAuth() { clears++; } };
  const context = vm.createContext({ AbortController, Headers, setTimeout, clearTimeout,
    fetch: async () => ({status: 401, ok: false, json: async () => ({detail})}) });
  const store = new vm.SyntheticModule(['default'], function() {
    this.setExport('default', {getState: () => state});
  }, {context});
  await store.link(() => {}); await store.evaluate();
  const source = new vm.SourceTextModule(await readFile('src/api/serverClient.js', 'utf8'), {
    context, importModuleDynamically: async () => store
  });
  await source.link(() => {}); await source.evaluate();
  return { request: source.namespace.serverRequest, clears: () => clears };
}

test('invalid login preserves credential error without clearing another session', async () => {
  const s = await setup('synthetic-active', 'Credentials do not match');
  await assert.rejects(s.request('/auth/login', {method: 'POST'}), /Credentials do not match/);
  assert.equal(s.clears(), 0);
});
test('late unauthorized request cannot log out a newer account', async () => {
  const s = await setup('synthetic-new', 'Invalid token');
  await assert.rejects(s.request('/auth/me', {headers: {Authorization: 'Bearer synthetic-old'}}));
  assert.equal(s.clears(), 0);
});
test('unauthorized current token clears its own session', async () => {
  const s = await setup('synthetic-current', 'Invalid token');
  await assert.rejects(s.request('/auth/me', {headers: {Authorization: 'Bearer synthetic-current'}}));
  assert.equal(s.clears(), 1);
});
