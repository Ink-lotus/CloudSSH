import test from 'node:test';
import assert from 'node:assert/strict';

import { filterHosts, getCommandResult, hosts, validateConnection } from '../src/data.js';

test('主机筛选支持分组、名称、IP 与标签', () => {
  assert.equal(filterHosts(hosts, '', '生产环境').length, 3);
  assert.equal(filterHosts(hosts, '47.100', '全部主机')[0].id, 'edge-gateway-01');
  assert.equal(filterHosts(hosts, 'postgresql', '全部主机')[0].id, 'db-primary-01');
  assert.equal(filterHosts(hosts, '不存在', '全部主机').length, 0);
});

test('连接表单校验覆盖必填项、端口与认证方式', () => {
  const emptyErrors = validateConnection({ authType: 'password', port: 70000 });
  assert.deepEqual(Object.keys(emptyErrors).sort(), ['host', 'name', 'password', 'port', 'user']);

  const validPassword = validateConnection({
    name: '生产 API', host: '10.0.0.8', port: '22', user: 'root', authType: 'password', password: 'secret'
  });
  assert.deepEqual(validPassword, {});

  const keyErrors = validateConnection({
    name: '密钥主机', host: 'server.local', port: '2222', user: 'deploy', authType: 'key', privateKey: ''
  });
  assert.equal(keyErrors.privateKey, '请输入私钥内容');
});

test('终端命令执行返回结构化结果并支持清屏', () => {
  const uptime = getCommandResult(' uptime ', hosts[0]);
  assert.equal(uptime.command, 'uptime');
  assert.match(uptime.prompt, /root@edge-gateway-01/);
  assert.match(uptime.output, /load average/);

  const clear = getCommandResult('clear', hosts[0]);
  assert.equal(clear.clear, true);

  const unknown = getCommandResult('unknown-command', hosts[0]);
  assert.match(unknown.output, /command not found/);
});
