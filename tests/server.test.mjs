import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';

import { createAppServer, resolveRequestPath } from '../server.mjs';

test('静态路径解析限制在项目目录内', () => {
  assert.match(resolveRequestPath('/'), /index\.html$/);
  assert.match(resolveRequestPath('/..%2Fpackage.json'), /index\.html$/);
  assert.match(resolveRequestPath('/src/data.js'), /src[\\/]data\.js$/);
});

test('HTTP 冒烟测试可加载页面、样式与模块', async (context) => {
  const server = createAppServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  context.after(() => server.close());

  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const [page, style, script] = await Promise.all([
    fetch(`${baseUrl}/`),
    fetch(`${baseUrl}/styles.css`),
    fetch(`${baseUrl}/src/app.js`)
  ]);

  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /text\/html/);
  assert.match(await page.text(), /Atlas SSH/);
  assert.equal(style.status, 200);
  assert.match(await style.text(), /\.app-shell/);
  assert.equal(script.status, 200);
  assert.match(await script.text(), /new-connection-button/);
});
