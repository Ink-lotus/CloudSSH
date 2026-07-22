import {
  files,
  filterHosts,
  getCommandResult,
  hosts,
  processes,
  quickCommands,
  validateConnection
} from './data.js';

const root = document.querySelector('#app');

const iconPaths = {
  activity: '<path d="M3 12h4l2.3-7 4.4 14 2.3-7h5"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/>',
  box: '<path d="m21 8-9-5-9 5 9 5 9-5Z"/><path d="m3 8 9 5 9-5M12 13v8"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  cloud: '<path d="M17.5 19H6a4 4 0 0 1-.6-7.95A6.5 6.5 0 0 1 18 9.5h.5a4.5 4.5 0 0 1-1 9.5Z"/>',
  code: '<path d="m8 9-3 3 3 3M16 9l3 3-3 3M14 5l-4 14"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  cpu: '<rect x="5" y="5" width="14" height="14" rx="2"/><path d="M9 9h6v6H9zM9 1v4M15 1v4M9 19v4M15 19v4M19 9h4M19 14h4M1 9h4M1 14h4"/>',
  database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v7c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12v7c0 1.7 3.6 3 8 3s8-1.3 8-3v-7"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/>',
  folder: '<path d="M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
  hardDrive: '<path d="M4 5h16l2 7H2l2-7Z"/><path d="M2 12v5a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-5M6 16h.01M10 16h.01"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.7 2.7 0 1 1 4.2 2.3c-1 .6-1.7 1.1-1.7 2.2M12 17h.01"/>',
  home: '<path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10M9 20v-6h6v6"/>',
  layers: '<path d="m12 2 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5M3 17l9 5 9-5"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.1.1l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1"/><path d="M14 11a5 5 0 0 0-7.1-.1l-2 2A5 5 0 0 0 12 20l1.1-1.1"/>',
  memory: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 10h2v4H7zM13 10h4v4h-4zM6 3v3M10 3v3M14 3v3M18 3v3M6 18v3M10 18v3M14 18v3M18 18v3"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  power: '<path d="M12 2v10M18.4 6.6a8 8 0 1 1-12.8 0"/>',
  refresh: '<path d="M20 6v5h-5M4 18v-5h5"/><path d="M18.5 9A7 7 0 0 0 6.1 6.1L4 11M5.5 15A7 7 0 0 0 17.9 17.9L20 13"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  server: '<rect x="3" y="3" width="18" height="7" rx="2"/><rect x="3" y="14" width="18" height="7" rx="2"/><path d="M7 6.5h.01M7 17.5h.01M11 6.5h6M11 17.5h6"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/>',
  sparkles: '<path d="m12 3 1.2 3.8L17 8l-3.8 1.2L12 13l-1.2-3.8L7 8l3.8-1.2L12 3ZM19 14l.7 2.3L22 17l-2.3.7L19 20l-.7-2.3L16 17l2.3-.7L19 14ZM5 13l.8 2.2L8 16l-2.2.8L5 19l-.8-2.2L2 16l2.2-.8L5 13Z"/>',
  terminal: '<path d="m4 17 6-5-6-5M12 19h8"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5M5 20h14"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>'
};

function icon(name, size = 18) {
  return `<svg aria-hidden="true" class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${iconPaths[name] || iconPaths.grid}</svg>`;
}

const state = {
  selectedHostId: hosts[0].id,
  group: '全部主机',
  query: '',
  view: 'terminal',
  connected: true,
  modalOpen: false,
  authType: 'password',
  terminalHistory: [
    { type: 'system', text: '正在建立安全会话…' },
    { type: 'success', text: '✓ 已连接至 edge-gateway-01 · Ubuntu 24.04 LTS' },
    { type: 'muted', text: 'Last login: Sun Jul 20 14:12:08 2026 from 10.20.8.14' },
    { type: 'command', prompt: 'root@edge-gateway-01:~$', command: 'uptime' },
    { type: 'output', text: ' 14:46:22 up 42 days, 8:11, 2 users, load average: 0.84, 0.72, 0.61' }
  ],
  toast: null
};

function selectedHost() {
  return hosts.find((host) => host.id === state.selectedHostId) || hosts[0];
}

function escapeHTML(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function statusLabel(status) {
  return { online: '运行正常', warning: '需要关注', offline: '当前离线' }[status] || status;
}

function metricTone(value) {
  if (value >= 80) return 'danger';
  if (value >= 65) return 'warning';
  return 'normal';
}

function navButton(name, label, iconName, badge = '') {
  return `
    <button class="nav-button ${state.view === name ? 'is-active' : ''}" data-nav="${name}" aria-label="${label}" title="${label}">
      ${icon(iconName, 20)}
      ${badge ? `<span class="nav-badge">${badge}</span>` : ''}
    </button>`;
}

function hostCard(host) {
  const statusText = host.status === 'online' ? `${host.latency} ms` : statusLabel(host.status);
  return `
    <button class="host-card ${host.id === state.selectedHostId ? 'is-active' : ''}" data-host-id="${host.id}">
      <span class="host-status-dot ${host.status}"></span>
      <span class="host-card-main">
        <span class="host-card-title-row">
          <strong>${escapeHTML(host.alias)}</strong>
          <span class="host-latency">${statusText}</span>
        </span>
        <span class="host-address">${escapeHTML(host.user)}@${escapeHTML(host.host)}:${host.port}</span>
        <span class="host-mini-metrics">
          <span>CPU ${host.cpu}%</span>
          <span>MEM ${host.memory}%</span>
          <span>${escapeHTML(host.region.split(' · ')[0])}</span>
        </span>
      </span>
      ${icon('chevron', 15)}
    </button>`;
}

function hostListHTML() {
  const visibleHosts = filterHosts(hosts, state.query, state.group);
  return `
    <div class="host-list-header">
      <span>${state.group}</span>
      <span class="host-count">${visibleHosts.length}</span>
    </div>
    <div class="host-list" role="list">
      ${visibleHosts.length
        ? visibleHosts.map(hostCard).join('')
        : `<div class="empty-state">${icon('search', 22)}<strong>没有匹配的主机</strong><span>尝试其他名称、IP 或标签</span></div>`}
    </div>`;
}

function renderMetric(label, value, iconName, suffix = '%') {
  return `
    <article class="metric-card">
      <div class="metric-icon">${icon(iconName, 18)}</div>
      <div class="metric-content">
        <span class="metric-label">${label}</span>
        <div class="metric-value-row"><strong>${value}${suffix}</strong><span>${value > 70 ? '负载偏高' : '状态稳定'}</span></div>
        <div class="metric-track"><span class="${metricTone(value)}" style="width:${Math.max(2, value)}%"></span></div>
      </div>
    </article>`;
}

function terminalView(host) {
  return `
    <section class="workspace-panel terminal-panel" aria-label="终端工作区">
      <div class="terminal-toolbar">
        <div class="terminal-tabs">
          <button class="terminal-tab is-active">
            <span class="live-dot"></span>
            ${escapeHTML(host.name)}
            <span class="tab-shortcut">1</span>
          </button>
          <button class="icon-button compact" data-action="new-terminal" aria-label="新建终端">${icon('plus', 15)}</button>
        </div>
        <div class="terminal-actions">
          <span class="terminal-encryption">${icon('shield', 14)} AES-256</span>
          <button class="icon-button compact" data-action="clear-terminal" aria-label="清空终端">${icon('refresh', 15)}</button>
        </div>
      </div>
      <div class="terminal-window" id="terminal-output" tabindex="0" aria-live="polite">
        <div class="terminal-welcome">
          <span class="terminal-mark">A_</span>
          <div><strong>Atlas Secure Shell</strong><span>会话已通过加密通道建立 · 输入 help 查看演示命令</span></div>
        </div>
        ${state.terminalHistory.map((line) => {
          if (line.type === 'command') {
            return `<div class="terminal-line command"><span class="prompt">${escapeHTML(line.prompt)}</span> <span>${escapeHTML(line.command)}</span></div>`;
          }
          return `<div class="terminal-line ${line.type}">${escapeHTML(line.text)}</div>`;
        }).join('')}
        <form class="terminal-input-row" id="terminal-form">
          <label for="terminal-command" class="prompt">${escapeHTML(host.user)}@${escapeHTML(host.name)}:~$</label>
          <input id="terminal-command" name="command" autocomplete="off" spellcheck="false" aria-label="输入终端命令" ${state.connected ? '' : 'disabled'} />
          <span class="terminal-cursor"></span>
        </form>
      </div>
      <div class="terminal-statusbar">
        <span>${icon('link', 13)} SSH-2 · ${host.latency ?? '—'} ms</span>
        <span>UTF-8</span>
        <span>80 × 24</span>
        <span class="terminal-shell">bash</span>
      </div>
    </section>`;
}

function filesView() {
  return `
    <section class="workspace-panel data-panel" aria-label="文件管理">
      <div class="data-toolbar">
        <div class="breadcrumb"><span>/</span><span>home</span><span>deploy</span></div>
        <div class="toolbar-actions">
          <button class="secondary-button" data-action="demo-toast">${icon('upload', 15)} 上传</button>
          <button class="primary-button small" data-action="demo-toast">${icon('plus', 15)} 新建</button>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>名称</th><th>大小</th><th>所有者</th><th>权限</th><th>修改时间</th></tr></thead>
          <tbody>
            ${files.map((file) => `<tr>
              <td><span class="file-name"><span class="file-icon ${file.type}">${icon(file.type === 'folder' ? 'folder' : 'file', 17)}</span>${escapeHTML(file.name)}</span></td>
              <td>${file.size}</td><td>${file.owner}</td><td><code>${file.permission}</code></td><td>${file.updated}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div class="panel-footer"><span>6 个项目</span><span>可用空间 42.6 GB</span></div>
    </section>`;
}

function monitoringView(host) {
  const chart = (values, color) => {
    const points = values.map((value, index) => `${(index / (values.length - 1)) * 100},${100 - value}`).join(' ');
    return `<svg class="spark-chart" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <defs><linearGradient id="fill-${color.slice(1)}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".32"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
      <polygon points="0,100 ${points} 100,100" fill="url(#fill-${color.slice(1)})"/>
      <polyline points="${points}" fill="none" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke"/>
    </svg>`;
  };
  return `
    <section class="workspace-panel monitor-panel" aria-label="监控视图">
      <div class="monitor-grid">
        <article class="chart-card wide">
          <div class="chart-header"><div><span>CPU 使用率</span><strong>${host.cpu}%</strong></div><span class="chart-range">最近 60 分钟</span></div>
          ${chart([24, 31, 28, 42, 36, 49, 56, 47, 64, 58, host.cpu], '#7886ff')}
          <div class="chart-axis"><span>13:45</span><span>14:15</span><span>现在</span></div>
        </article>
        <article class="chart-card">
          <div class="chart-header"><div><span>内存</span><strong>${host.memory}%</strong></div></div>
          ${chart([45, 48, 52, 50, 57, 63, 61, 66, host.memory], '#2ad6a4')}
          <div class="chart-legend"><span><i class="green"></i>已用 9.9 GB</span><span>共 16 GB</span></div>
        </article>
        <article class="chart-card">
          <div class="chart-header"><div><span>网络 I/O</span><strong>18.4 MB/s</strong></div></div>
          ${chart([12, 22, 18, 36, 29, 47, 41, 62, 54], '#bb78ff')}
          <div class="chart-legend"><span><i class="purple"></i>下行 12.8</span><span>上行 5.6 MB/s</span></div>
        </article>
        <article class="chart-card wide compact-chart">
          <div class="chart-header"><div><span>系统健康事件</span><strong class="healthy">全部正常</strong></div></div>
          <div class="health-events">
            <span>${icon('shield', 17)} SSH 服务正常</span>
            <span>${icon('database', 17)} 磁盘 I/O 正常</span>
            <span>${icon('cloud', 17)} 网络链路稳定</span>
          </div>
        </article>
      </div>
    </section>`;
}

function processesView() {
  return `
    <section class="workspace-panel data-panel" aria-label="进程管理">
      <div class="data-toolbar">
        <div><strong>活动进程</strong><span class="toolbar-subtitle">共 186 个进程，2 个用户会话</span></div>
        <button class="secondary-button" data-action="demo-toast">${icon('refresh', 15)} 刷新</button>
      </div>
      <div class="table-wrap">
        <table class="process-table">
          <thead><tr><th>PID</th><th>进程</th><th>用户</th><th>CPU</th><th>内存</th><th>状态</th></tr></thead>
          <tbody>
            ${processes.map((process) => `<tr>
              <td><code>${process.pid}</code></td><td class="process-name">${escapeHTML(process.name)}</td><td>${process.user}</td>
              <td><span class="usage-number ${metricTone(process.cpu)}">${process.cpu}%</span></td>
              <td>${process.memory}%</td><td><span class="process-status">${process.status}</span></td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div class="panel-footer"><span>系统负载 0.84 / 0.72 / 0.61</span><span>自动刷新：5 秒</span></div>
    </section>`;
}

function workspaceView(host) {
  return {
    terminal: terminalView(host),
    files: filesView(),
    monitoring: monitoringView(host),
    processes: processesView()
  }[state.view] || terminalView(host);
}

function rightRail(host) {
  return `
    <aside class="right-rail">
      <section class="rail-card ai-card">
        <div class="rail-heading"><span class="ai-icon">${icon('sparkles', 17)}</span><div><strong>Atlas Copilot</strong><span>运维建议</span></div></div>
        <div class="insight-box">
          <span class="insight-label">实时洞察</span>
          <p>${host.status === 'warning' ? '数据库节点内存持续高于 85%，建议检查共享缓冲区与慢查询。' : '当前节点整体运行稳定，过去 30 分钟没有检测到异常事件。'}</p>
          <button data-action="demo-toast">查看诊断 ${icon('chevron', 13)}</button>
        </div>
      </section>
      <section class="rail-card">
        <div class="rail-heading"><div><strong>快捷命令</strong><span>常用检查脚本</span></div><button class="icon-button compact" data-action="demo-toast" aria-label="管理快捷命令">${icon('settings', 14)}</button></div>
        <div class="quick-command-list">
          ${quickCommands.map((item) => `<button data-command="${escapeHTML(item.command)}"><span>${icon('terminal', 15)} ${item.label}</span><code>${escapeHTML(item.command)}</code></button>`).join('')}
        </div>
      </section>
      <section class="rail-card activity-card">
        <div class="rail-heading"><div><strong>最近活动</strong><span>此主机</span></div></div>
        <div class="activity-list">
          <div><span class="activity-dot success"></span><p><strong>部署完成</strong><span>atlas-api:2026.07 · 18 分钟前</span></p></div>
          <div><span class="activity-dot info"></span><p><strong>密钥登录</strong><span>来自 10.20.8.14 · 34 分钟前</span></p></div>
          <div><span class="activity-dot muted"></span><p><strong>自动快照</strong><span>保留点 #2048 · 2 小时前</span></p></div>
        </div>
      </section>
      <div class="rail-footnote">${icon('shield', 13)} 会话记录仅保存在本地演示状态</div>
    </aside>`;
}

function connectionModal() {
  if (!state.modalOpen) return '';
  return `
    <div class="modal-backdrop" data-action="close-modal">
      <section class="modal" role="dialog" aria-modal="true" aria-labelledby="connection-title" data-modal-panel>
        <div class="modal-header">
          <div><span class="modal-icon">${icon('server', 21)}</span><div><h2 id="connection-title">新建 SSH 连接</h2><p>添加一台服务器到当前工作区</p></div></div>
          <button class="icon-button" data-action="close-modal" aria-label="关闭">${icon('x', 18)}</button>
        </div>
        <form id="connection-form" novalidate>
          <div class="form-grid two-columns">
            <label class="field"><span>连接名称</span><input name="name" placeholder="例如：生产环境 API" autocomplete="off"/><small data-error="name"></small></label>
            <label class="field"><span>分组</span><select name="group"><option>生产环境</option><option>预发布</option><option>开发环境</option></select></label>
          </div>
          <div class="form-grid host-port-grid">
            <label class="field"><span>主机地址</span><input name="host" placeholder="IP 地址或域名" autocomplete="off"/><small data-error="host"></small></label>
            <label class="field"><span>端口</span><input name="port" value="22" inputmode="numeric"/><small data-error="port"></small></label>
          </div>
          <label class="field"><span>用户名</span><input name="user" value="root" autocomplete="username"/><small data-error="user"></small></label>
          <div class="auth-switch" role="tablist">
            <button type="button" class="${state.authType === 'password' ? 'is-active' : ''}" data-auth="password">${icon('user', 15)} 密码登录</button>
            <button type="button" class="${state.authType === 'key' ? 'is-active' : ''}" data-auth="key">${icon('shield', 15)} 密钥登录</button>
          </div>
          ${state.authType === 'password'
            ? `<label class="field"><span>密码</span><input name="password" type="password" placeholder="输入主机密码" autocomplete="current-password"/><small data-error="password"></small></label>`
            : `<label class="field"><span>私钥</span><textarea name="privateKey" rows="4" placeholder="粘贴 OpenSSH 私钥内容"></textarea><small data-error="privateKey"></small></label>`}
          <label class="check-field"><input type="checkbox" name="remember" checked/><span>记住此连接配置</span></label>
          <div class="connection-note">${icon('shield', 15)} 此原型不会发送或保存凭据；真实连接需接入服务端 SSH 网关。</div>
          <div class="modal-actions"><button type="button" class="secondary-button" data-action="close-modal">取消</button><button type="submit" class="primary-button">${icon('link', 15)} 测试并连接</button></div>
        </form>
      </section>
    </div>`;
}

function render() {
  const host = selectedHost();
  const groupNames = ['全部主机', '生产环境', '预发布', '开发环境'];
  root.innerHTML = `
    <div class="app-shell">
      <nav class="global-nav" aria-label="全局导航">
        <div class="brand-mark" aria-label="Atlas SSH"><span>A</span><i></i></div>
        <div class="nav-stack primary-nav">
          ${navButton('terminal', '终端', 'terminal')}
          ${navButton('files', '文件', 'folder')}
          ${navButton('monitoring', '监控', 'activity')}
          ${navButton('processes', '进程', 'cpu')}
        </div>
        <div class="nav-stack nav-bottom">
          <button class="nav-button" data-action="demo-toast" aria-label="帮助">${icon('help', 20)}</button>
          <button class="nav-button" data-action="demo-toast" aria-label="设置">${icon('settings', 20)}</button>
          <button class="avatar-button" data-action="demo-toast" aria-label="用户账户">IL<span></span></button>
        </div>
      </nav>

      <aside class="host-sidebar">
        <div class="sidebar-brand"><div><strong>ATLAS</strong><span>SSH CONSOLE</span></div><button class="icon-button compact" data-action="collapse-sidebar" aria-label="折叠侧栏">${icon('menu', 17)}</button></div>
        <button class="new-connection-button" data-action="open-modal">${icon('plus', 16)} 新建连接 <kbd>⌘ K</kbd></button>
        <label class="search-box">${icon('search', 16)}<input id="host-search" placeholder="搜索主机、IP 或标签" value="${escapeHTML(state.query)}"/><kbd>/</kbd></label>
        <div class="group-list">
          ${groupNames.map((group) => `<button class="${state.group === group ? 'is-active' : ''}" data-group="${group}"><span>${icon(group === '全部主机' ? 'layers' : group === '生产环境' ? 'server' : group === '预发布' ? 'cloud' : 'code', 15)}${group}</span><em>${group === '全部主机' ? hosts.length : hosts.filter((hostItem) => hostItem.group === group).length}</em></button>`).join('')}
        </div>
        <div class="host-list-region" id="host-list-region">${hostListHTML()}</div>
        <div class="sidebar-footer"><span><i></i>服务状态正常</span><button data-action="demo-toast">v1.0.0</button></div>
      </aside>

      <main class="main-area">
        <header class="topbar">
          <div class="breadcrumb-line"><span>基础设施</span>${icon('chevron', 13)}<span>${escapeHTML(host.group)}</span>${icon('chevron', 13)}<strong>${escapeHTML(host.name)}</strong></div>
          <div class="topbar-actions">
            <button class="icon-button notification-button" data-action="demo-toast" aria-label="通知">${icon('bell', 18)}<span></span></button>
            <button class="connection-button ${state.connected ? 'connected' : ''}" data-action="toggle-connection">${icon(state.connected ? 'power' : 'link', 15)} ${state.connected ? '断开连接' : '重新连接'}</button>
          </div>
        </header>

        <div class="page-content">
          <section class="server-heading">
            <div class="server-identity">
              <div class="server-avatar" style="--accent:${host.accent}">${icon('server', 25)}<span class="host-status-dot ${host.status}"></span></div>
              <div><div class="title-row"><h1>${escapeHTML(host.alias)}</h1><span class="status-pill ${host.status}">${statusLabel(host.status)}</span></div><p>${escapeHTML(host.user)}@${escapeHTML(host.host)}:${host.port}<button class="copy-button" data-copy="${escapeHTML(host.host)}" aria-label="复制主机地址">${icon('copy', 13)}</button><span>·</span>${escapeHTML(host.os)}</p></div>
            </div>
            <div class="server-meta"><div><span>区域</span><strong>${escapeHTML(host.region)}</strong></div><div><span>运行时间</span><strong>${escapeHTML(host.uptime)}</strong></div><div><span>负载</span><strong>${escapeHTML(host.load)}</strong></div></div>
          </section>

          <section class="metrics-grid">
            ${renderMetric('CPU', host.cpu, 'cpu')}
            ${renderMetric('内存', host.memory, 'memory')}
            ${renderMetric('磁盘', host.disk, 'hardDrive')}
            <article class="metric-card network-card"><div class="metric-icon">${icon('globe', 18)}</div><div class="metric-content"><span class="metric-label">网络延迟</span><div class="metric-value-row"><strong>${host.latency ?? '—'}<small> ms</small></strong><span>${host.latency && host.latency < 50 ? '链路优良' : '等待响应'}</span></div><div class="network-bars"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div></div></article>
          </section>

          <div class="workspace-tabs" role="tablist">
            ${[
              ['terminal', '终端', 'terminal'], ['files', '文件管理', 'folder'], ['monitoring', '性能监控', 'activity'], ['processes', '进程', 'cpu']
            ].map(([view, label, iconName]) => `<button class="${state.view === view ? 'is-active' : ''}" data-nav="${view}" role="tab">${icon(iconName, 15)}${label}</button>`).join('')}
          </div>

          <div class="workspace-layout">
            ${workspaceView(host)}
            ${rightRail(host)}
          </div>
        </div>
      </main>
      ${connectionModal()}
      ${state.toast ? `<div class="toast"><span>${icon('shield', 16)}</span>${escapeHTML(state.toast)}</div>` : ''}
    </div>`;

  requestAnimationFrame(() => {
    const output = document.querySelector('#terminal-output');
    if (output) output.scrollTop = output.scrollHeight;
  });
}

function showToast(message) {
  state.toast = message;
  render();
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    state.toast = null;
    render();
  }, 2400);
}

function selectHost(hostId) {
  const host = hosts.find((item) => item.id === hostId);
  if (!host) return;
  state.selectedHostId = host.id;
  state.connected = host.status !== 'offline';
  state.terminalHistory = [
    { type: 'system', text: `正在切换到 ${host.alias}…` },
    state.connected
      ? { type: 'success', text: `✓ 已连接至 ${host.name} · ${host.os}` }
      : { type: 'error', text: `连接失败：${host.name} 当前离线` }
  ];
  render();
}

function executeCommand(command) {
  if (!state.connected) return;
  const result = getCommandResult(command, selectedHost());
  if (!result) return;
  if (result.clear) {
    state.terminalHistory = [];
  } else {
    state.terminalHistory.push(
      { type: 'command', prompt: result.prompt, command: result.command },
      { type: 'output', text: result.output }
    );
  }
  state.view = 'terminal';
  render();
  requestAnimationFrame(() => document.querySelector('#terminal-command')?.focus());
}

function readConnectionForm(form) {
  const data = new FormData(form);
  return {
    name: data.get('name'),
    group: data.get('group'),
    host: data.get('host'),
    port: data.get('port'),
    user: data.get('user'),
    password: data.get('password'),
    privateKey: data.get('privateKey'),
    authType: state.authType
  };
}

function showFormErrors(errors) {
  document.querySelectorAll('[data-error]').forEach((node) => {
    const message = errors[node.dataset.error] || '';
    node.textContent = message;
    node.closest('.field')?.classList.toggle('has-error', Boolean(message));
  });
}

root.addEventListener('click', async (event) => {
  const hostButton = event.target.closest('[data-host-id]');
  if (hostButton) {
    selectHost(hostButton.dataset.hostId);
    return;
  }

  const navButtonElement = event.target.closest('[data-nav]');
  if (navButtonElement) {
    state.view = navButtonElement.dataset.nav;
    render();
    return;
  }

  const groupButton = event.target.closest('[data-group]');
  if (groupButton) {
    state.group = groupButton.dataset.group;
    render();
    return;
  }

  const authButton = event.target.closest('[data-auth]');
  if (authButton) {
    state.authType = authButton.dataset.auth;
    render();
    return;
  }

  const commandButton = event.target.closest('[data-command]');
  if (commandButton) {
    executeCommand(commandButton.dataset.command);
    return;
  }

  const copyButton = event.target.closest('[data-copy]');
  if (copyButton) {
    try {
      await navigator.clipboard.writeText(copyButton.dataset.copy);
      showToast('主机地址已复制');
    } catch {
      showToast('复制失败，请手动复制');
    }
    return;
  }

  const actionButton = event.target.closest('[data-action]');
  if (!actionButton) return;
  const action = actionButton.dataset.action;

  if (action === 'open-modal') {
    state.modalOpen = true;
    render();
    requestAnimationFrame(() => document.querySelector('[name="name"]')?.focus());
  }
  if (action === 'close-modal' && (!event.target.closest('[data-modal-panel]') || event.target.closest('button'))) {
    state.modalOpen = false;
    render();
  }
  if (action === 'toggle-connection') {
    const host = selectedHost();
    if (host.status === 'offline' && !state.connected) {
      showToast('主机离线，无法建立会话');
      return;
    }
    state.connected = !state.connected;
    state.terminalHistory.push({
      type: state.connected ? 'success' : 'error',
      text: state.connected ? `✓ 会话已重新连接 · ${host.name}` : `会话已由本地用户断开 · ${host.name}`
    });
    render();
  }
  if (action === 'clear-terminal') {
    state.terminalHistory = [];
    render();
  }
  if (action === 'new-terminal') showToast('已创建新的终端标签');
  if (action === 'collapse-sidebar') document.querySelector('.app-shell')?.classList.toggle('sidebar-collapsed');
  if (action === 'demo-toast') showToast('该操作已在演示模式中触发');
});

root.addEventListener('input', (event) => {
  if (event.target.id !== 'host-search') return;
  state.query = event.target.value;
  const region = document.querySelector('#host-list-region');
  if (region) region.innerHTML = hostListHTML();
});

root.addEventListener('submit', (event) => {
  event.preventDefault();
  if (event.target.id === 'terminal-form') {
    const input = event.target.elements.command;
    executeCommand(input.value);
    return;
  }

  if (event.target.id === 'connection-form') {
    const formData = readConnectionForm(event.target);
    const errors = validateConnection(formData);
    if (Object.keys(errors).length) {
      showFormErrors(errors);
      return;
    }

    const newHost = {
      id: `host-${Date.now()}`,
      name: String(formData.name).trim().toLowerCase().replace(/\s+/g, '-'),
      alias: String(formData.name).trim(),
      group: formData.group,
      host: String(formData.host).trim(),
      port: Number(formData.port),
      user: String(formData.user).trim(),
      os: 'Linux · 待识别',
      kernel: '待识别',
      status: 'online',
      latency: 36,
      cpu: 12,
      memory: 28,
      disk: 18,
      uptime: '刚刚连接',
      load: '0.12 / 0.08 / 0.04',
      region: '未分配区域',
      tags: ['新主机'],
      accent: '#6f7cff'
    };
    hosts.unshift(newHost);
    state.selectedHostId = newHost.id;
    state.group = '全部主机';
    state.modalOpen = false;
    state.connected = true;
    state.terminalHistory = [
      { type: 'system', text: '正在测试连接配置…' },
      { type: 'success', text: `✓ 演示连接成功 · ${newHost.alias}` },
      { type: 'muted', text: '真实 SSH 握手将在接入服务端网关后执行。' }
    ];
    state.toast = '主机已添加到工作区';
    render();
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && state.modalOpen) {
    state.modalOpen = false;
    render();
  }
  if (event.key === '/' && !state.modalOpen && !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) {
    event.preventDefault();
    document.querySelector('#host-search')?.focus();
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    state.modalOpen = true;
    render();
    requestAnimationFrame(() => document.querySelector('[name="name"]')?.focus());
  }
});

render();
