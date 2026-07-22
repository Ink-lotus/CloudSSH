export const hosts = [
  {
    id: 'edge-gateway-01',
    name: 'edge-gateway-01',
    alias: '上海边缘网关',
    group: '生产环境',
    host: '47.100.22.18',
    port: 22,
    user: 'root',
    os: 'Ubuntu 24.04 LTS',
    kernel: '6.8.0-41-generic',
    status: 'online',
    latency: 24,
    cpu: 38,
    memory: 62,
    disk: 44,
    uptime: '42 天 8 小时',
    load: '0.84 / 0.72 / 0.61',
    region: '上海 · CN-East',
    tags: ['网关', 'Nginx', 'Docker'],
    accent: '#6f7cff'
  },
  {
    id: 'api-prod-02',
    name: 'api-prod-02',
    alias: '核心 API 节点',
    group: '生产环境',
    host: '10.24.8.32',
    port: 22,
    user: 'deploy',
    os: 'Debian 12',
    kernel: '6.1.0-21-amd64',
    status: 'online',
    latency: 31,
    cpu: 71,
    memory: 78,
    disk: 59,
    uptime: '18 天 3 小时',
    load: '1.82 / 1.44 / 1.21',
    region: '上海 · CN-East',
    tags: ['Node.js', 'PM2', 'Redis'],
    accent: '#2ad6a4'
  },
  {
    id: 'db-primary-01',
    name: 'db-primary-01',
    alias: '主数据库',
    group: '生产环境',
    host: '10.24.12.8',
    port: 2222,
    user: 'dba',
    os: 'Rocky Linux 9.4',
    kernel: '5.14.0-427.el9',
    status: 'warning',
    latency: 46,
    cpu: 84,
    memory: 88,
    disk: 76,
    uptime: '96 天 11 小时',
    load: '3.14 / 2.88 / 2.42',
    region: '杭州 · CN-East',
    tags: ['PostgreSQL', '主库'],
    accent: '#ffb14a'
  },
  {
    id: 'staging-web-01',
    name: 'staging-web-01',
    alias: '预发布 Web',
    group: '预发布',
    host: '172.16.4.19',
    port: 22,
    user: 'ubuntu',
    os: 'Ubuntu 22.04 LTS',
    kernel: '5.15.0-107-generic',
    status: 'online',
    latency: 62,
    cpu: 22,
    memory: 41,
    disk: 37,
    uptime: '6 天 14 小时',
    load: '0.34 / 0.28 / 0.25',
    region: '新加坡 · AP-SG',
    tags: ['测试', 'Docker'],
    accent: '#bb78ff'
  },
  {
    id: 'dev-sandbox',
    name: 'dev-sandbox',
    alias: '开发沙箱',
    group: '开发环境',
    host: '192.168.12.77',
    port: 22,
    user: 'dev',
    os: 'Fedora 40',
    kernel: '6.9.7-200.fc40',
    status: 'offline',
    latency: null,
    cpu: 0,
    memory: 0,
    disk: 31,
    uptime: '—',
    load: '—',
    region: '本地机房',
    tags: ['沙箱'],
    accent: '#7b879d'
  }
];

export const files = [
  { name: 'apps', type: 'folder', size: '—', owner: 'deploy', permission: 'drwxr-xr-x', updated: '今天 14:32' },
  { name: 'backups', type: 'folder', size: '—', owner: 'root', permission: 'drwx------', updated: '今天 03:00' },
  { name: 'logs', type: 'folder', size: '—', owner: 'syslog', permission: 'drwxr-x---', updated: '2 分钟前' },
  { name: 'docker-compose.yml', type: 'yaml', size: '3.8 KB', owner: 'deploy', permission: '-rw-r--r--', updated: '昨天 19:18' },
  { name: 'deploy.sh', type: 'shell', size: '7.2 KB', owner: 'deploy', permission: '-rwxr-xr-x', updated: '7 月 18 日' },
  { name: '.env.production', type: 'env', size: '1.1 KB', owner: 'root', permission: '-rw-------', updated: '7 月 12 日' }
];

export const processes = [
  { pid: 31842, name: 'node /srv/api/server.js', user: 'deploy', cpu: 18.4, memory: 12.8, status: '运行中' },
  { pid: 1194, name: 'dockerd -H fd://', user: 'root', cpu: 7.1, memory: 5.3, status: '运行中' },
  { pid: 28871, name: 'nginx: worker process', user: 'www-data', cpu: 4.6, memory: 1.8, status: '运行中' },
  { pid: 2088, name: 'redis-server 127.0.0.1:6379', user: 'redis', cpu: 3.2, memory: 8.6, status: '运行中' },
  { pid: 883, name: 'systemd-journald', user: 'root', cpu: 0.8, memory: 0.9, status: '睡眠' },
  { pid: 4271, name: 'sshd: deploy@pts/2', user: 'deploy', cpu: 0.2, memory: 0.3, status: '运行中' }
];

export const quickCommands = [
  { label: '系统概况', command: 'uptime' },
  { label: '磁盘空间', command: 'df -h' },
  { label: '容器状态', command: 'docker ps' },
  { label: '最近登录', command: 'last -n 5' }
];

export function filterHosts(items, query = '', group = '全部主机') {
  const normalized = query.trim().toLowerCase();
  return items.filter((host) => {
    const inGroup = group === '全部主机' || host.group === group;
    const matchesQuery = !normalized || [host.name, host.alias, host.host, ...host.tags]
      .join(' ')
      .toLowerCase()
      .includes(normalized);
    return inGroup && matchesQuery;
  });
}

export function validateConnection(form) {
  const errors = {};
  if (!form.name?.trim()) errors.name = '请输入连接名称';
  if (!form.host?.trim()) errors.host = '请输入主机地址';
  if (!form.user?.trim()) errors.user = '请输入用户名';
  const port = Number(form.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) errors.port = '端口范围应为 1-65535';
  if (form.authType === 'password' && !form.password) errors.password = '请输入密码';
  if (form.authType === 'key' && !form.privateKey?.trim()) errors.privateKey = '请输入私钥内容';
  return errors;
}

export function getCommandResult(command, host = hosts[0]) {
  const normalized = command.trim().replace(/\s+/g, ' ');
  const prompt = `${host.user}@${host.name}:~$`;

  const results = {
    help: '可用演示命令：uptime、df -h、docker ps、last -n 5、uname -a、whoami、pwd、ls -la、clear',
    uptime: ` ${new Date().toLocaleTimeString('zh-CN', { hour12: false })} up ${host.uptime},  2 users,  load average: ${host.load}`,
    'df -h': 'Filesystem      Size  Used Avail Use% Mounted on\n/dev/vda1        80G   35G   42G  46% /\ntmpfs           3.8G  2.1M  3.8G   1% /run\n/dev/vdb1       200G  116G   74G  62% /data',
    'docker ps': 'CONTAINER ID   IMAGE                    STATUS          PORTS                  NAMES\n9bf2e1c4a812   atlas-api:2026.07      Up 18 hours     0.0.0.0:3000->3000/tcp api-prod\n33a7f82c19e0   nginx:1.27-alpine      Up 18 hours     0.0.0.0:80->80/tcp     edge-nginx\n48f9ba410d1a   redis:7.4-alpine       Up 12 days      6379/tcp               cache-main',
    'last -n 5': 'deploy   pts/2        10.20.8.14      Sun Jul 20 14:12   still logged in\nroot     pts/1        10.20.8.22      Sun Jul 20 10:48 - 11:16  (00:28)\ndeploy   pts/0        10.20.8.14      Sat Jul 19 21:03 - 22:41  (01:38)',
    'uname -a': `Linux ${host.name} ${host.kernel} #1 SMP PREEMPT_DYNAMIC x86_64 GNU/Linux`,
    whoami: host.user,
    pwd: `/home/${host.user}`,
    'ls -la': 'total 48\ndrwxr-x--- 7 deploy deploy 4096 Jul 20 14:32 .\ndrwxr-xr-x 4 root   root   4096 Apr 18 09:12 ..\ndrwxr-xr-x 6 deploy deploy 4096 Jul 20 14:32 apps\ndrwx------ 3 root   root   4096 Jul 20 03:00 backups\n-rwxr-xr-x 1 deploy deploy 7341 Jul 18 16:44 deploy.sh'
  };

  if (!normalized) return null;
  if (normalized === 'clear') return { clear: true, prompt, command: normalized, output: '' };

  return {
    clear: false,
    prompt,
    command: normalized,
    output: results[normalized] ?? `bash: ${normalized.split(' ')[0]}: command not found\n输入 help 查看可用演示命令。`
  };
}
