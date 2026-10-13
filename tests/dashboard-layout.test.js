import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

test('workspace switch is disabled during a cloud operation and enabled when idle', async () => {
  const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
  try {
    const { DashboardLayout } = await server.ssrLoadModule('/src/components/dashboard-layout.jsx');
    const props = { navigation: [{ id: 'overview', title: 'Overview', icon: () => null }], page: 'overview', onPage() {}, pending: 0, mode: 'cloud', connect() {}, backToDemo() {} };
    for (const busy of ['extract', 'review', 'collect', 'connect', null]) {
      const html = renderToStaticMarkup(React.createElement(DashboardLayout, { ...props, busy }));
      const button = html.match(/<button\b[^>]*>Back to demo<\/button>/)?.[0];
      assert.ok(button, 'workspace switch must render');
      assert.equal(button.includes('disabled=""'), Boolean(busy), `busy=${busy}`);
    }
  } finally { await server.close(); }
});
