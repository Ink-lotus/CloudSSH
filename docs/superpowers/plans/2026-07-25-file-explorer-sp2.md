# SP2 资源管理器（Plan A：核心资源管理器 + 后端扩展）实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 用独立的资源管理器 App 替换现有 SFTP 滑出面板，提供多连接、多标签页、桌面/移动双模式的文件浏览与管理体验（跨服务器传输拆到 Plan B）。

**架构：** 复用现有两 WebSocket 架构（主 WS 建立 SSH shell 会话并下发 `sftp_attach` URL，SFTP WS 承载文件操作）。`ConnectionPool` 为每台服务器持有一个隐藏 `SSHTerminal`（零改动复用已验证的主 WS 握手），并封装一个 `SFTPConnection`（Promise 化 SFTP 操作）。每个标签页持有独立的 `ExplorerState` + `ExplorerActions`。UI 层分 `DesktopExplorer`（树+标签+列表）与 `MobileExplorer`（单面板）。后端在 SFTP WS 上新增 `chmod` / `readTextFile` / `exec` 三个操作，其中 `exec` 直接复用现有 `executeAgentCommand`。

**技术栈：** TypeScript、Vite、Tailwind CSS、Vitest（纯逻辑单测，Node 环境）、Cloudflare Workers + Durable Objects（后端 SSH/SFTP）。

**范围边界：**
- ✅ Plan A：连接池、状态、操作（含同服务器复制/移动）、标签页、桌面/移动 UI、打开方式菜单、chmod、搜索、后端 chmod/readText/exec、移除旧面板。
- ⛔ Plan B（不在本计划）：跨服务器传输三级策略（DO 中转、R2+wget、浏览器兜底）。本计划中 `paste()` 遇到跨服务器场景时抛出"暂不支持"提示，接口预留。

**关键架构决策：**
1. **连接来源。** 资源管理器解耦但仍走现有连接链路：`POST /api/servers/{id}/connect` → 主 wsUrl → 隐藏 `SSHTerminal.connectWithWebSocket()` → `shell_ready` → `terminal.getSFTPWebSocketUrl()` → SFTP WS。不复制 terminal.ts 握手逻辑，不改后端连接流程。
2. **exec 通道。** SFTP WS 新增 `sftp_exec` 消息，后端复用 `SSHSession.executeAgentCommand()`（已实现 exec channel 完整生命周期）。供同服务器 `cp -r` 与远程 `find` 搜索使用。
3. **chmod。** `SFTPClient` 新增 `setStat()`（`SSH_FXP_SETSTAT`，仅设 permissions），`SFTPHandler.chmod()` 封装，SFTP WS 新增 `sftp_chmod`。
4. **readTextFile。** `SFTPHandler.readTextFile()` 复用下载读取逻辑但聚合为文本返回，SFTP WS 新增 `sftp_read_text`（仅小文件，>1MB 拒绝，编辑走 nano/vim 终端）。
5. **可测试性。** 纯逻辑（server-data、connection-pool 引用计数、explorer-state 选择/剪贴板/历史/排序、tab-manager CRUD、setStat 包构建）走 TDD 单测；UI 渲染（现有代码库无 DOM 测试）走完整实现 + 手动验证步骤。

---

## 文件结构

### 新建文件

| 文件 | 职责 |
|------|------|
| `frontend/src/shared/server-data.ts` | 共享服务器数据获取（`fetchSavedServers` / `connectServerWs`），供 servers-app 与 explorer 复用 |
| `frontend/src/explorer/sftp-connection.ts` | 单连接 SFTP WebSocket 管理，全部操作 Promise 化（从 SFTPPanel 提取），含 `SFTPFileEntry` 类型 |
| `frontend/src/explorer/connection-pool.ts` | 多服务器连接池，隐藏 SSHTerminal + SFTPConnection + 引用计数 |
| `frontend/src/explorer/explorer-state.ts` | 单标签页状态（路径/文件/选中/剪贴板/历史/排序），纯逻辑 + onChange 通知 |
| `frontend/src/explorer/explorer-actions.ts` | 业务操作（导航/CRUD/同服务器复制移动/chmod/搜索/打开方式） |
| `frontend/src/explorer/tab-manager.ts` | 标签页 CRUD、切换、拖出为独立窗口 |
| `frontend/src/explorer/context-menu.ts` | 通用弹出菜单（右键/竖三点），含"打开方式"二级子菜单 |
| `frontend/src/explorer/server-picker.ts` | 服务器选择页渲染 |
| `frontend/src/explorer/desktop-explorer.ts` | 桌面布局：目录树 + 标签栏 + 详细列表 + 面包屑 + 工具栏 |
| `frontend/src/explorer/mobile-explorer.ts` | 移动布局：单面板 + 路径栏 + 竖三点菜单 + 全局菜单 |
| `frontend/src/apps/explorer-app.ts` | App 入口：注册 ShellApp，打开窗口，装配连接池/标签/UI |
| `tests/explorer/*.test.ts` | 纯逻辑单测 |

### 修改文件

| 文件 | 变更 |
|------|------|
| `src/ssh/sftp.ts` | 新增 `setStat()` 方法（chmod 用） |
| `src/worker/sftp-handler.ts` | 新增 `chmod()` / `readTextFile()` 方法 |
| `src/worker/ssh-session.ts` | `handleSFTPMessage` 路由新增 `sftp_chmod` / `sftp_read_text` / `sftp_exec` |
| `frontend/src/apps/terminal-app.ts` | `createTerminalWindow` 新增 `initialCommand` 参数；移除 SFTPPanel 相关代码 |
| `frontend/src/main.ts` | 注册 explorer App |
| `frontend/src/i18n/locales/zh-CN.ts` | 移除 `sftp.*` 键，新增 `explorer.*` 键 |
| `frontend/src/i18n/locales/en-US.ts` | 同步 `explorer.*` 键 |

### 删除文件

| 文件 | 说明 |
|------|------|
| `frontend/src/sftp-panel.ts` | 旧 SFTP 面板，被资源管理器完全替代 |

---

## 任务总览

**Part 1 — 后端 SFTP 扩展**
- 任务 1：`SFTPClient.setStat()`（chmod 底层）
- 任务 2：`SFTPHandler.chmod()` + `readTextFile()`
- 任务 3：`ssh-session.ts` 路由 `sftp_chmod` / `sftp_read_text` / `sftp_exec`

**Part 2 — 共享数据层**
- 任务 4：`shared/server-data.ts`

**Part 3 — 连接层**
- 任务 5：`explorer/sftp-connection.ts`
- 任务 6：`explorer/connection-pool.ts`

**Part 4 — 状态与操作**
- 任务 7：`explorer/explorer-state.ts`
- 任务 8：`explorer/explorer-actions.ts`

**Part 5 — 标签管理**
- 任务 9：`explorer/tab-manager.ts`

**Part 6 — UI 组件**
- 任务 10：`explorer/context-menu.ts`
- 任务 11：`explorer/server-picker.ts`
- 任务 12：`explorer/desktop-explorer.ts`
- 任务 13：`explorer/mobile-explorer.ts`

**Part 7 — 集成与迁移**
- 任务 14：`terminal-app.ts` 加 `initialCommand`
- 任务 15：`apps/explorer-app.ts`（装配）
- 任务 16：`main.ts` 注册 + i18n
- 任务 17：删除旧 SFTP 面板 + 收尾

---

## Part 1 — 后端 SFTP 扩展

### 任务 1：`SFTPClient.setStat()`

在 SFTP 协议层新增 `SSH_FXP_SETSTAT` 请求，仅携带 permissions 属性（chmod 用）。

**文件：**
- 修改：`src/ssh/sftp.ts`（在 `rename()` 后，约 366-376 行之后新增方法）
- 测试：`tests/ssh/sftp-setstat.test.ts`（新建）

- [ ] **步骤 1：编写失败的测试**

新建 `tests/ssh/sftp-setstat.test.ts`。`setStat` 内部调用 `sendRequest`，我们通过注入 `setSendCallback` 捕获发出的原始包字节，断言包结构正确（type=9、flags=0x04、mode 正确）。

```typescript
import { describe, it, expect } from 'vitest';
import { SFTPClient } from '../../src/ssh/sftp';
import { SSH_FXP_SETSTAT, SSH_FILEXFER_ATTR_PERMISSIONS } from '../../src/ssh/sftp-types';
import { readUint32 } from '../../src/ssh/utils';

describe('SFTPClient.setStat', () => {
  it('构造 SSH_FXP_SETSTAT 包：path + flags(PERMISSIONS) + mode', () => {
    const client = new SFTPClient();
    let sent: Uint8Array | null = null;
    client.setSendCallback((data) => { sent = data; });

    // 不 await（无响应回来），只捕获发出的包
    void client.setStat('/tmp/a.txt', 0o644);

    expect(sent).not.toBeNull();
    const pkt = sent as unknown as Uint8Array;
    // 包布局：len(4) | type(1) | reqId(4) | path-string(4+len) | attr-flags(4) | mode(4)
    const packetLen = readUint32(pkt, 0);
    expect(pkt.length).toBe(4 + packetLen);
    expect(pkt[4]).toBe(SSH_FXP_SETSTAT); // type = 9

    const pathLen = readUint32(pkt, 9);
    expect(pathLen).toBe('/tmp/a.txt'.length);
    const attrOffset = 9 + 4 + pathLen;
    expect(readUint32(pkt, attrOffset)).toBe(SSH_FILEXFER_ATTR_PERMISSIONS); // 0x04
    expect(readUint32(pkt, attrOffset + 4)).toBe(0o644);
  });
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`npx vitest run tests/ssh/sftp-setstat.test.ts`
预期：FAIL，报错 `client.setStat is not a function`。

- [ ] **步骤 3：编写最少实现代码**

在 `src/ssh/sftp.ts` 顶部 import 补充 `SSH_FXP_SETSTAT` 与 `SSH_FILEXFER_ATTR_PERMISSIONS`（`SSH_FILEXFER_ATTR_PERMISSIONS` 已在 import 列表，只需补 `SSH_FXP_SETSTAT`）：

```typescript
// 在现有 import { ... } from './sftp-types' 中补充：
  SSH_FXP_SETSTAT,
```

在 `rename()` 方法之后新增（参照 `openDir` / `stat` 的 `encodeString` + `writeUint32` 编码风格）：

```typescript
  // SSH_FXP_SETSTAT —— 仅设置 permissions（chmod）
  async setStat(path: string, permissions: number): Promise<Uint8Array> {
    const reqId = this.nextRequestId();
    const pathBytes = encodeString(path);
    // path-string | attr-flags(4) | permissions(4)
    const payload = new Uint8Array(pathBytes.length + 4 + 4);
    let offset = 0;
    payload.set(pathBytes, offset);
    offset += pathBytes.length;
    writeUint32(payload, offset, SSH_FILEXFER_ATTR_PERMISSIONS);
    offset += 4;
    writeUint32(payload, offset, permissions >>> 0);
    return this.sendRequest(reqId, SSH_FXP_SETSTAT, payload);
  }
```

- [ ] **步骤 4：运行测试验证通过**

运行：`npx vitest run tests/ssh/sftp-setstat.test.ts`
预期：PASS。

- [ ] **步骤 5：Commit**

```bash
git add src/ssh/sftp.ts tests/ssh/sftp-setstat.test.ts
git commit -m "feat(sftp): SFTPClient.setStat 支持 chmod（SSH_FXP_SETSTAT）"
```

---

### 任务 2：`SFTPHandler.chmod()` + `readTextFile()`

在 SFTP 处理层封装 chmod 与小文件文本读取。

**文件：**
- 修改：`src/worker/sftp-handler.ts`（在 `removeDirectory()` 后、`formatEntry()` 前新增两个方法；`SFTPOperation` 类型补充；import 补充读取常量）

- [ ] **步骤 1：扩展 `SFTPOperation` 类型**

`src/worker/sftp-handler.ts` 第 32 行，把新增操作并入类型：

```typescript
type SFTPOperation = 'init' | 'list' | 'stat' | 'download' | 'upload' | 'delete' | 'rename' | 'mkdir' | 'rmdir' | 'chmod' | 'readText' | 'exec';
```

- [ ] **步骤 2：新增 `chmod()` 方法**

在 `removeDirectory()`（约 785 行）之后新增。参照 `renamePath()` 的 status 校验风格：

```typescript
  // chmod —— 设置文件权限
  async chmod(path: string, mode: number): Promise<void> {
    if (!this.ready) {
      this.sendError('chmod', 'SFTP 未就绪');
      return;
    }

    try {
      const resp = await this.sftp.setStat(path, mode);
      if (resp[0] === SSH_FXP_STATUS) {
        const status = this.sftp.parseStatusResponse(resp);
        if (status.code !== SSH_FX_OK) {
          this.sendError('chmod', status.message);
          return;
        }
      }
      this.sendJSON({ type: 'sftp_chmod_result', path, mode, success: true });
    } catch (e) {
      this.sendError('chmod', '权限修改失败: ' + (e instanceof Error ? e.message : String(e)));
    }
  }
```

- [ ] **步骤 3：新增 `readTextFile()` 方法**

紧接 `chmod()` 之后新增。复用 `stat` 判断大小上限（1MB），再用 `openFile`+`readFile` 循环聚合，最后 `closeHandle`。参照 `downloadFile`（367 行起）的读取风格但聚合为字符串：

```typescript
  // 读取小文件文本内容（编辑走 nano/vim，此处仅用于轻量预览/兜底）
  async readTextFile(path: string): Promise<void> {
    if (!this.ready) {
      this.sendError('readText', 'SFTP 未就绪');
      return;
    }

    const MAX_TEXT_SIZE = 1 * 1024 * 1024; // 1MB
    try {
      // 1. stat 校验大小
      const statResp = await this.sftp.stat(path);
      if (statResp[0] === SSH_FXP_STATUS) {
        const status = this.sftp.parseStatusResponse(statResp);
        this.sendError('readText', status.message);
        return;
      }
      const { attrs } = this.sftp.parseAttributes(statResp, 1);
      const size = attrs.size || 0;
      if (size > MAX_TEXT_SIZE) {
        this.sendError('readText', `文件过大（${formatFileSize(size)}），请用编辑器打开`);
        return;
      }

      // 2. open(read)
      const openResp = await this.sftp.openFile(path, SSH_FXF_READ);
      if (openResp[0] === SSH_FXP_STATUS) {
        const status = this.sftp.parseStatusResponse(openResp);
        this.sendError('readText', status.message);
        return;
      }
      const handle = this.sftp.parseHandleResponse(openResp);

      // 3. 循环读取聚合
      const chunks: Uint8Array[] = [];
      let offset = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const dataResp = await this.sftp.readFile(handle, offset, DOWNLOAD_CHUNK_SIZE);
        if (dataResp[0] === SSH_FXP_STATUS) {
          const status = this.sftp.parseStatusResponse(dataResp);
          if (status.code === SSH_FX_EOF) break;
          await this.sftp.closeHandle(handle);
          this.sendError('readText', status.message);
          return;
        }
        // SSH_FXP_DATA: type(1) reqId(4) dataLen(4) data
        const dataLen = ((dataResp[5] << 24) | (dataResp[6] << 16) | (dataResp[7] << 8) | dataResp[8]) >>> 0;
        chunks.push(dataResp.subarray(9, 9 + dataLen));
        offset += dataLen;
        if (dataLen < DOWNLOAD_CHUNK_SIZE) break;
      }
      await this.sftp.closeHandle(handle);

      // 4. 拼接解码
      const total = chunks.reduce((s, c) => s + c.length, 0);
      const merged = new Uint8Array(total);
      let p = 0;
      for (const c of chunks) { merged.set(c, p); p += c.length; }
      const content = new TextDecoder().decode(merged);
      this.sendJSON({ type: 'sftp_read_text_result', path, content });
    } catch (e) {
      this.sendError('readText', '读取失败: ' + (e instanceof Error ? e.message : String(e)));
    }
  }
```

- [ ] **步骤 4：确认依赖的 SFTPClient 辅助方法存在**

`readTextFile` 依赖 `parseHandleResponse`。确认 `src/ssh/sftp.ts` 已有该方法：

运行：`grep -n "parseHandleResponse\|parseStatusResponse\|parseAttributes" src/ssh/sftp.ts`
预期：三者均存在（`downloadFile` 已使用它们）。若 `parseHandleResponse` 不存在，改用 `downloadFile` 中相同的 handle 解析方式（读取 `SSH_FXP_HANDLE` 响应的 string）。

- [ ] **步骤 5：编译校验**

运行：`npx tsc --noEmit -p tsconfig.json`
预期：无类型错误（确认 `SSH_FXF_READ`、`DOWNLOAD_CHUNK_SIZE`、`formatFileSize`、`SSH_FX_EOF` 均已在文件顶部 import——它们在 `downloadFile` 中已被使用，应已存在）。

- [ ] **步骤 6：Commit**

```bash
git add src/worker/sftp-handler.ts
git commit -m "feat(sftp): SFTPHandler 新增 chmod 与 readTextFile"
```

---

### 任务 3：`ssh-session.ts` 路由新增消息

在 SFTP 消息分发中接入 `sftp_chmod` / `sftp_read_text` / `sftp_exec`。`sftp_exec` 复用现有 `executeAgentCommand`。

**文件：**
- 修改：`src/worker/ssh-session.ts`（`handleSFTPMessage` 的 switch，约 1481-1518 行；`getSFTPOperation` 映射）

- [ ] **步骤 1：在 `handleSFTPMessage` switch 中新增三个 case**

在 `case 'sftp_close':`（1515 行）之前插入：

```typescript
      case 'sftp_chmod':
        await this.sftpHandler.chmod(msg.path, msg.mode);
        break;
      case 'sftp_read_text':
        await this.sftpHandler.readTextFile(msg.path);
        break;
      case 'sftp_exec': {
        // 复用 exec channel：供同服务器 cp -r 与远程 find 搜索
        try {
          const result = await this.executeAgentCommand(msg.command, msg.timeout || 30000);
          this.sendSFTPJSON({
            type: 'sftp_exec_result',
            id: msg.id,
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.exitCode,
          });
        } catch (e) {
          this.sendSFTPJSON({
            type: 'sftp_exec_result',
            id: msg.id,
            stdout: '',
            stderr: e instanceof Error ? e.message : String(e),
            exitCode: -1,
          });
        }
        break;
      }
```

- [ ] **步骤 2：更新 `getSFTPOperation` 映射**

`getSFTPOperation`（约 1576 行起）的 switch 补充新类型，避免错误提示显示为 unknown：

```typescript
      case 'sftp_chmod':
        return 'chmod';
      case 'sftp_read_text':
        return 'readText';
      case 'sftp_exec':
        return 'exec';
```

- [ ] **步骤 3：确认 `sftp_exec` 走 SFTP WS 时序无阻塞**

`sftp_exec` 通过 `enqueueSFTPTask`（1419 行 `handleSFTPWebSocketMessage` 的默认分支）串行执行。确认 `executeAgentCommand` 是独立 channel、不与 SFTP channel 冲突（它用 `nextChannelID++` 分配新 channel）。无需改动，仅确认。

运行：`grep -n "enqueueSFTPTask\|executeAgentCommand" src/worker/ssh-session.ts`
预期：确认 `sftp_exec` 消息会进入 SFTP 任务队列并调用 `executeAgentCommand`。

- [ ] **步骤 4：编译校验**

运行：`npx tsc --noEmit -p tsconfig.json`
预期：无类型错误。

- [ ] **步骤 5：跑后端相关测试确保未破坏**

运行：`npx vitest run tests/ssh tests/worker`
预期：全部 PASS。

- [ ] **步骤 6：Commit**

```bash
git add src/worker/ssh-session.ts
git commit -m "feat(sftp): SFTP WS 路由 chmod/read_text/exec（exec 复用 executeAgentCommand）"
```

---
## Part 2 — 共享数据层

### 任务 4：`shared/server-data.ts`

提取服务器数据获取，供 servers-app 与 explorer 共用。映射逻辑纯函数化以便单测。

**文件：**
- 创建：`frontend/src/shared/server-data.ts`
- 测试：`tests/explorer/server-data.test.ts`（新建）

- [ ] **步骤 1：编写失败的测试**

新建 `tests/explorer/server-data.test.ts`。只测纯映射函数 `toSavedServer`（fetch 部分是 IO，不测）：

```typescript
import { describe, it, expect } from 'vitest';
import { toSavedServer } from '../../frontend/src/shared/server-data';

describe('toSavedServer', () => {
  it('从 ServerConfig 提取资源管理器所需字段', () => {
    const config = {
      id: 7, user_id: 1, name: '开发机', host: '10.0.0.2', port: 2222,
      username: 'root', auth_method: 'password' as const,
      region: null, inferred_hint: null, created_at: '', updated_at: '',
    };
    expect(toSavedServer(config)).toEqual({
      id: 7, name: '开发机', host: '10.0.0.2', port: 2222, username: 'root',
    });
  });
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`npx vitest run tests/explorer/server-data.test.ts`
预期：FAIL，模块不存在。

- [ ] **步骤 3：编写实现**

创建 `frontend/src/shared/server-data.ts`：

```typescript
// 共享服务器数据获取 —— servers-app 与 explorer 复用

export interface ServerConfig {
  id: number;
  user_id: number;
  name: string;
  host: string;
  port: number;
  username: string;
  auth_method: 'password' | 'publickey';
  region?: string | null;
  inferred_hint?: string | null;
  created_at: string;
  updated_at: string;
}

/** 资源管理器/选择页所需的精简服务器信息 */
export interface SavedServer {
  id: number;
  name: string;
  host: string;
  port: number;
  username: string;
}

/** ServerConfig → SavedServer（纯映射，可单测） */
export function toSavedServer(c: ServerConfig): SavedServer {
  return { id: c.id, name: c.name, host: c.host, port: c.port, username: c.username };
}

/** 拉取已保存服务器列表 */
export async function fetchSavedServers(): Promise<SavedServer[]> {
  const res = await fetch('/api/servers');
  if (!res.ok) throw new Error('Failed to fetch servers');
  const list = (await res.json()) as ServerConfig[];
  return list.map(toSavedServer);
}

/** 请求建立连接，返回主 WebSocket URL（含一次性 token） */
export async function connectServerWs(serverId: number): Promise<string> {
  const res = await fetch(`/api/servers/${serverId}/connect`, { method: 'POST' });
  if (!res.ok) {
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      const err = (await res.json()) as { error?: string };
      throw new Error(err.error || 'Connection failed');
    }
    throw new Error(`服务器错误 (${res.status})`);
  }
  const { wsUrl } = (await res.json()) as { wsUrl: string };
  return wsUrl;
}
```

- [ ] **步骤 4：运行测试验证通过**

运行：`npx vitest run tests/explorer/server-data.test.ts`
预期：PASS。

- [ ] **步骤 5：Commit**

```bash
git add frontend/src/shared/server-data.ts tests/explorer/server-data.test.ts
git commit -m "feat(explorer): 共享服务器数据获取 server-data"
```

---

## Part 3 — 连接层

### 任务 5：`explorer/sftp-connection.ts`

从 `SFTPPanel` 提取 WebSocket 连接与文件操作逻辑，全部 Promise 化。所有操作走串行队列（与后端 `enqueueSFTPTask` 串行语义一致），避免无请求 id 的响应错配。

**文件：**
- 创建：`frontend/src/explorer/sftp-connection.ts`

设计说明：
- 接收 `getWebSocketUrl: () => string | null`（由连接池注入，来自隐藏终端的 `getSFTPWebSocketUrl()`），与旧 `SFTPPanel` 完全相同的取址模式。
- 单例响应操作（list/stat/delete/rmdir/rename/mkdir/chmod/read_text）用 `request(msg, expectedType)`：串行入队、发送、等待匹配类型的响应。
- `download`/`upload` 多阶段流式，单独实现但同样入队串行。
- `exec` 带 `id` 关联响应（`sftp_exec_result`），也入队。

- [ ] **步骤 1：编写类型与骨架**

创建 `frontend/src/explorer/sftp-connection.ts`：

```typescript
// 独立 SFTP WebSocket 连接 —— 全部操作 Promise 化（从 SFTPPanel 提取）

export interface SFTPFileEntry {
  name: string;
  type: 'dir' | 'link' | 'file';
  size: number;
  sizeFormatted: string;
  permissions: string;
  permissionsRaw: number;
  modifiedTime: number;
  isDir: boolean;
  isLink: boolean;
}

export type ProgressCb = (loaded: number, total: number) => void;
export type GetSFTPWebSocketUrlFn = () => string | null;

export interface SFTPConnectionCallbacks {
  onReady: () => void;
  onDisconnect: () => void;
  onError: (err: string) => void;
}

const SFTP_HEARTBEAT_INTERVAL_MS = 30000;
const UPLOAD_CHUNK_SIZE = 128 * 1024;

class Deferred<T> {
  promise: Promise<T>;
  resolve!: (value: T | PromiseLike<T>) => void;
  reject!: (reason?: unknown) => void;
  constructor() {
    this.promise = new Promise<T>((res, rej) => { this.resolve = res; this.reject = rej; });
  }
}
```

- [ ] **步骤 2：编写连接管理与消息分发**

追加 `SFTPConnection` 类的连接部分：

```typescript
export class SFTPConnection {
  private ws: WebSocket | null = null;
  private getWebSocketUrl: GetSFTPWebSocketUrlFn;
  private cbs: SFTPConnectionCallbacks | null = null;
  private ready = false;
  private heartbeat: ReturnType<typeof setInterval> | null = null;

  // 串行队列 + 当前在途操作
  private queueTail: Promise<void> = Promise.resolve();
  private pending: Deferred<any> | null = null;
  private expectedType: string | null = null;

  // 流式传输状态
  private downloadChunks: Uint8Array[] = [];
  private downloadDeferred: Deferred<Blob> | null = null;
  private downloadProgress: ProgressCb | null = null;
  private downloadTotal = 0;
  private uploadReadyDeferred: Deferred<void> | null = null;
  private uploadProgressDeferred: Deferred<number> | null = null;
  private uploadDoneDeferred: Deferred<void> | null = null;

  // exec：id → resolver
  private execPending = new Map<string, Deferred<string>>();
  private execSeq = 0;

  constructor(getWebSocketUrl: GetSFTPWebSocketUrlFn) {
    this.getWebSocketUrl = getWebSocketUrl;
  }

  connect(cbs: SFTPConnectionCallbacks): void {
    this.cbs = cbs;
    const url = this.getWebSocketUrl();
    if (!url) { cbs.onError('SFTP 地址不可用'); return; }

    const ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;

    ws.onopen = () => { this.send({ type: 'sftp_init' }); this.startHeartbeat(); };
    ws.onmessage = (e) => this.handleMessage(e.data);
    ws.onclose = () => { this.ready = false; this.stopHeartbeat(); this.cbs?.onDisconnect(); };
    ws.onerror = () => this.cbs?.onError('SFTP 连接错误');
  }

  isReady(): boolean { return this.ready; }

  dispose(): void {
    this.stopHeartbeat();
    this.ready = false;
    try { this.ws?.close(1000); } catch { /* ignore */ }
    this.ws = null;
    this.pending?.reject(new Error('连接已关闭'));
    this.pending = null;
    this.execPending.forEach((d) => d.reject(new Error('连接已关闭')));
    this.execPending.clear();
  }

  private startHeartbeat(): void {
    this.heartbeat = setInterval(() => this.send({ type: 'ping' }), SFTP_HEARTBEAT_INTERVAL_MS);
  }
  private stopHeartbeat(): void {
    if (this.heartbeat) { clearInterval(this.heartbeat); this.heartbeat = null; }
  }

  private send(msg: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }
  private sendBinary(data: ArrayBuffer | Uint8Array): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(data);
  }

  private handleMessage(data: string | ArrayBuffer): void {
    if (typeof data !== 'string') {
      // 下载二进制块
      const chunk = new Uint8Array(data);
      this.downloadChunks.push(chunk);
      if (this.downloadProgress) {
        const loaded = this.downloadChunks.reduce((s, c) => s + c.length, 0);
        this.downloadProgress(loaded, this.downloadTotal);
      }
      return;
    }
    let msg: any;
    try { msg = JSON.parse(data); } catch { return; }

    switch (msg.type) {
      case 'sftp_ready':
        this.ready = true;
        this.cbs?.onReady();
        break;
      case 'pong':
        break;
      // ---- 单例操作响应 ----
      case 'sftp_list_result':
        this.resolvePending('sftp_list_result', msg.entries as SFTPFileEntry[]);
        break;
      case 'sftp_stat_result':
        this.resolvePending('sftp_stat_result', msg);
        break;
      case 'sftp_delete_result':
        this.resolvePending('sftp_delete_result', undefined);
        break;
      case 'sftp_rmdir_result':
        this.resolvePending('sftp_rmdir_result', undefined);
        break;
      case 'sftp_rename_result':
        this.resolvePending('sftp_rename_result', undefined);
        break;
      case 'sftp_mkdir_result':
        this.resolvePending('sftp_mkdir_result', undefined);
        break;
      case 'sftp_chmod_result':
        this.resolvePending('sftp_chmod_result', undefined);
        break;
      case 'sftp_read_text_result':
        this.resolvePending('sftp_read_text_result', msg.content as string);
        break;
      // ---- 下载流 ----
      case 'sftp_download_start':
        this.downloadChunks = [];
        this.downloadTotal = msg.size || 0;
        break;
      case 'sftp_download_done': {
        const blob = new Blob(this.downloadChunks as BlobPart[]);
        this.downloadChunks = [];
        this.downloadDeferred?.resolve(blob);
        this.downloadDeferred = null;
        this.downloadProgress = null;
        break;
      }
      // ---- 上传流 ----
      case 'sftp_upload_ready':
        this.uploadReadyDeferred?.resolve();
        this.uploadReadyDeferred = null;
        break;
      case 'sftp_upload_progress':
        this.uploadProgressDeferred?.resolve(msg.loaded || 0);
        this.uploadProgressDeferred = null;
        break;
      case 'sftp_upload_complete':
        this.uploadDoneDeferred?.resolve();
        this.uploadDoneDeferred = null;
        break;
      // ---- exec ----
      case 'sftp_exec_result': {
        const d = this.execPending.get(msg.id);
        if (d) {
          this.execPending.delete(msg.id);
          if (msg.exitCode === 0) d.resolve(msg.stdout);
          else d.reject(new Error(msg.stderr || `exit ${msg.exitCode}`));
        }
        break;
      }
      // ---- 错误 ----
      case 'sftp_error':
        this.rejectPending(msg.message || 'SFTP 操作失败');
        this.downloadDeferred?.reject(new Error(msg.message));
        this.uploadReadyDeferred?.reject(new Error(msg.message));
        this.uploadProgressDeferred?.reject(new Error(msg.message));
        this.uploadDoneDeferred?.reject(new Error(msg.message));
        break;
    }
  }

  private resolvePending(type: string, value: unknown): void {
    if (this.pending && this.expectedType === type) {
      const d = this.pending;
      this.pending = null; this.expectedType = null;
      d.resolve(value);
    }
  }
  private rejectPending(message: string): void {
    if (this.pending) {
      const d = this.pending;
      this.pending = null; this.expectedType = null;
      d.reject(new Error(message));
    }
  }
```

- [ ] **步骤 3：编写串行 request 与单例操作方法**

追加（仍在类内）：

```typescript
  /** 串行入队 + 发送 + 等待匹配响应 */
  private request<T>(msg: Record<string, unknown>, expectedType: string): Promise<T> {
    const run = this.queueTail.then(() => {
      const d = new Deferred<T>();
      this.pending = d;
      this.expectedType = expectedType;
      this.send(msg);
      return d.promise;
    });
    // 队尾推进（吞掉错误，避免链断裂；错误已由调用方 promise 抛出）
    this.queueTail = run.then(() => undefined, () => undefined);
    return run;
  }

  listDirectory(path: string): Promise<SFTPFileEntry[]> {
    return this.request<SFTPFileEntry[]>({ type: 'sftp_list', path }, 'sftp_list_result');
  }
  stat(path: string): Promise<SFTPFileEntry> {
    return this.request<SFTPFileEntry>({ type: 'sftp_stat', path }, 'sftp_stat_result');
  }
  deleteFile(path: string): Promise<void> {
    return this.request<void>({ type: 'sftp_delete', path }, 'sftp_delete_result');
  }
  deleteDirectory(path: string): Promise<void> {
    return this.request<void>({ type: 'sftp_rmdir', path }, 'sftp_rmdir_result');
  }
  rename(oldPath: string, newPath: string): Promise<void> {
    return this.request<void>({ type: 'sftp_rename', oldPath, newPath }, 'sftp_rename_result');
  }
  mkdir(path: string): Promise<void> {
    return this.request<void>({ type: 'sftp_mkdir', path }, 'sftp_mkdir_result');
  }
  chmod(path: string, mode: number): Promise<void> {
    return this.request<void>({ type: 'sftp_chmod', path, mode }, 'sftp_chmod_result');
  }
  readTextFile(path: string): Promise<string> {
    return this.request<string>({ type: 'sftp_read_text', path }, 'sftp_read_text_result');
  }

  exec(command: string, timeout = 30000): Promise<string> {
    const id = `exec-${++this.execSeq}`;
    const d = new Deferred<string>();
    this.execPending.set(id, d);
    const run = this.queueTail.then(() => {
      this.send({ type: 'sftp_exec', id, command, timeout });
      return d.promise;
    });
    this.queueTail = run.then(() => undefined, () => undefined);
    return run;
  }
```

- [ ] **步骤 4：编写 download / upload 流式方法**

追加（仍在类内），复用旧 `SFTPPanel` 的分块上传逻辑（128KB 块）：

```typescript
  downloadFile(path: string, onProgress?: ProgressCb): Promise<Blob> {
    const run = this.queueTail.then(() => {
      this.downloadDeferred = new Deferred<Blob>();
      this.downloadChunks = [];
      this.downloadProgress = onProgress || null;
      this.send({ type: 'sftp_download', path });
      return this.downloadDeferred.promise;
    });
    this.queueTail = run.then(() => undefined, () => undefined);
    return run;
  }

  uploadFile(path: string, data: Blob, onProgress?: ProgressCb): Promise<void> {
    const run = this.queueTail.then(async () => {
      const total = data.size;
      // 1. start，等 ready
      this.uploadReadyDeferred = new Deferred<void>();
      this.send({ type: 'sftp_upload_start', path, size: total });
      await this.uploadReadyDeferred.promise;

      // 2. 分块发送，每块等一次 progress 回执
      const reader = data.stream().getReader();
      let sent = 0;
      let buffer = new Uint8Array(0);
      const flushChunk = async (chunk: Uint8Array) => {
        this.uploadProgressDeferred = new Deferred<number>();
        this.sendBinary(chunk);
        await this.uploadProgressDeferred.promise;
        sent += chunk.length;
        onProgress?.(sent, total);
      };
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        // 累积并按 128KB 切分
        const merged = new Uint8Array(buffer.length + value.length);
        merged.set(buffer, 0); merged.set(value, buffer.length);
        buffer = merged;
        while (buffer.length >= UPLOAD_CHUNK_SIZE) {
          await flushChunk(buffer.subarray(0, UPLOAD_CHUNK_SIZE));
          buffer = buffer.subarray(UPLOAD_CHUNK_SIZE);
        }
      }
      if (buffer.length > 0) await flushChunk(buffer);

      // 3. end，等 complete
      this.uploadDoneDeferred = new Deferred<void>();
      this.send({ type: 'sftp_upload_end' });
      await this.uploadDoneDeferred.promise;
    });
    this.queueTail = run.then(() => undefined, () => undefined);
    return run;
  }
}
```

- [ ] **步骤 5：编译校验**

运行：`npx tsc --noEmit -p tsconfig.json`
预期：无类型错误。

> 说明：`SFTPConnection` 无独立单测（纯 IO/协议胶水，依赖真实 WS）。其正确性通过任务 6 连接池与手动集成验证覆盖。协议契约已由后端 `sftp-handler.ts` 与旧 `sftp-panel.ts` 双向验证。

- [ ] **步骤 6：Commit**

```bash
git add frontend/src/explorer/sftp-connection.ts
git commit -m "feat(explorer): SFTPConnection —— Promise 化 SFTP 连接与操作"
```

---
### 任务 6：`explorer/connection-pool.ts`

管理多服务器连接：每台服务器一个隐藏 `SSHTerminal`（复用主 WS 握手拿 SFTP URL）+ 一个 `SFTPConnection`，配合引用计数供多标签共享。引用计数抽为纯类 `ConnectionRefCounter` 以便在 node 环境单测（连接池主体依赖 DOM/WS，走手动验证）。

**文件：**
- 创建：`frontend/src/explorer/connection-pool.ts`
- 测试：`tests/explorer/ref-counter.test.ts`（新建）

- [ ] **步骤 1：编写失败的测试（引用计数纯逻辑）**

新建 `tests/explorer/ref-counter.test.ts`：

```typescript
import { describe, it, expect } from 'vitest';
import { ConnectionRefCounter } from '../../frontend/src/explorer/connection-pool';

describe('ConnectionRefCounter', () => {
  it('acquire 递增、release 递减，不为负', () => {
    const rc = new ConnectionRefCounter();
    expect(rc.acquire(1)).toBe(1);
    expect(rc.acquire(1)).toBe(2);
    expect(rc.count(1)).toBe(2);
    expect(rc.release(1)).toBe(1);
    expect(rc.release(1)).toBe(0);
    expect(rc.release(1)).toBe(0); // 不为负
  });

  it('不同服务器独立计数', () => {
    const rc = new ConnectionRefCounter();
    rc.acquire(1); rc.acquire(2); rc.acquire(2);
    expect(rc.count(1)).toBe(1);
    expect(rc.count(2)).toBe(2);
  });
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`npx vitest run tests/explorer/ref-counter.test.ts`
预期：FAIL，模块不存在。

- [ ] **步骤 3：编写引用计数类 + 连接池**

创建 `frontend/src/explorer/connection-pool.ts`：

```typescript
// 多服务器 SFTP 连接池 —— 隐藏 SSHTerminal + SFTPConnection + 引用计数

import { SSHTerminal } from '../terminal';
import { SFTPConnection } from './sftp-connection';
import { connectServerWs, type SavedServer } from '../shared/server-data';

/** 引用计数纯逻辑（可单测） */
export class ConnectionRefCounter {
  private counts = new Map<number, number>();
  acquire(id: number): number {
    const n = (this.counts.get(id) || 0) + 1;
    this.counts.set(id, n);
    return n;
  }
  release(id: number): number {
    const n = Math.max(0, (this.counts.get(id) || 0) - 1);
    this.counts.set(id, n);
    return n;
  }
  count(id: number): number { return this.counts.get(id) || 0; }
}

export interface PooledConnection {
  server: SavedServer;
  terminal: SSHTerminal;
  connection: SFTPConnection;
}

export class ConnectionPool {
  private pool = new Map<number, PooledConnection>();
  private refs = new ConnectionRefCounter();
  private changeCbs = new Set<() => void>();
  private hiddenHost: HTMLElement;
  private connecting = new Map<number, Promise<SFTPConnection>>();

  constructor() {
    this.hiddenHost = document.createElement('div');
    this.hiddenHost.style.cssText = 'position:absolute;left:-9999px;top:0;width:0;height:0;overflow:hidden;';
    document.body.appendChild(this.hiddenHost);
  }

  /** 建立或复用连接。并发调用同一服务器共享同一 Promise。 */
  connect(server: SavedServer): Promise<SFTPConnection> {
    const existing = this.pool.get(server.id);
    if (existing) return Promise.resolve(existing.connection);
    const inflight = this.connecting.get(server.id);
    if (inflight) return inflight;

    const p = this.doConnect(server).finally(() => this.connecting.delete(server.id));
    this.connecting.set(server.id, p);
    return p;
  }

  private async doConnect(server: SavedServer): Promise<SFTPConnection> {
    // 1. 隐藏容器 + headless 终端
    const mountEl = document.createElement('div');
    mountEl.id = `explorer-conn-${server.id}`;
    mountEl.style.cssText = 'width:400px;height:300px;';
    this.hiddenHost.appendChild(mountEl);
    const terminal = new SSHTerminal(mountEl.id);
    terminal.mount();

    // 2. 主 WS，等 shell_ready
    const wsUrl = await connectServerWs(server.id);
    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';
    await new Promise<void>((resolve, reject) => {
      terminal.setSessionReadyHandler(() => resolve());
      terminal.setSessionClosedHandler(() => reject(new Error('主连接已关闭')));
      terminal.connectWithWebSocket(ws, { host: server.host, port: server.port });
    });

    // 3. SFTP 连接
    const connection = new SFTPConnection(() => terminal.getSFTPWebSocketUrl());
    await new Promise<void>((resolve, reject) => {
      connection.connect({
        onReady: () => resolve(),
        onError: (e) => reject(new Error(e)),
        onDisconnect: () => this.notify(),
      });
    });

    this.pool.set(server.id, { server, terminal, connection });
    this.notify();
    return connection;
  }

  acquire(serverId: number): void { this.refs.acquire(serverId); }
  release(serverId: number): number { return this.refs.release(serverId); }
  refCount(serverId: number): number { return this.refs.count(serverId); }

  get(serverId: number): SFTPConnection | null {
    return this.pool.get(serverId)?.connection ?? null;
  }
  getServer(serverId: number): SavedServer | null {
    return this.pool.get(serverId)?.server ?? null;
  }
  getAll(): PooledConnection[] { return [...this.pool.values()]; }
  isConnected(serverId: number): boolean { return this.pool.has(serverId); }

  disconnect(serverId: number): void {
    const p = this.pool.get(serverId);
    if (!p) return;
    p.connection.dispose();
    p.terminal.disconnect();
    p.terminal.dispose();
    const el = document.getElementById(`explorer-conn-${serverId}`);
    el?.remove();
    this.pool.delete(serverId);
    this.notify();
  }

  disposeAll(): void {
    [...this.pool.keys()].forEach((id) => this.disconnect(id));
    this.hiddenHost.remove();
    this.changeCbs.clear();
  }

  onChange(cb: () => void): () => void {
    this.changeCbs.add(cb);
    return () => this.changeCbs.delete(cb);
  }
  private notify(): void { this.changeCbs.forEach((cb) => cb()); }
}
```

- [ ] **步骤 4：运行测试验证通过**

运行：`npx vitest run tests/explorer/ref-counter.test.ts`
预期：PASS。

- [ ] **步骤 5：确认 `SSHTerminal` 依赖方法齐全**

运行：`grep -n "mount()\|setSessionReadyHandler\|setSessionClosedHandler\|connectWithWebSocket\|getSFTPWebSocketUrl\|disconnect()\|dispose()" frontend/src/terminal.ts`
预期：全部存在（连接池仅调用 SSHTerminal 现有公开方法，零改动）。

- [ ] **步骤 6：编译校验 + Commit**

运行：`npx tsc --noEmit -p tsconfig.json`
预期：无类型错误。

```bash
git add frontend/src/explorer/connection-pool.ts tests/explorer/ref-counter.test.ts
git commit -m "feat(explorer): ConnectionPool —— 多服务器连接与引用计数"
```

---
## Part 4 — 状态与操作

### 任务 7：`explorer/explorer-state.ts`

单标签页状态容器，选择/排序/历史/剪贴板均为纯逻辑，完整 TDD。UI 通过 `onChange` 订阅。

**文件：**
- 创建：`frontend/src/explorer/explorer-state.ts`
- 测试：`tests/explorer/explorer-state.test.ts`（新建）

- [ ] **步骤 1：编写失败的测试**

新建 `tests/explorer/explorer-state.test.ts`：

```typescript
import { describe, it, expect } from 'vitest';
import { ExplorerState } from '../../frontend/src/explorer/explorer-state';
import type { SFTPFileEntry } from '../../frontend/src/explorer/sftp-connection';

function entry(name: string, over: Partial<SFTPFileEntry> = {}): SFTPFileEntry {
  return {
    name, type: 'file', size: 0, sizeFormatted: '0 B',
    permissions: '-rw-r--r--', permissionsRaw: 0o644, modifiedTime: 0,
    isDir: false, isLink: false, ...over,
  };
}

describe('ExplorerState 选择', () => {
  it('single 清除其他选中并设锚点', () => {
    const s = new ExplorerState('t1', 1);
    s.setFiles([entry('a'), entry('b'), entry('c')]);
    s.select('a', 'single');
    s.select('b', 'single');
    expect([...s.selected]).toEqual(['b']);
  });
  it('toggle 增删', () => {
    const s = new ExplorerState('t1', 1);
    s.setFiles([entry('a'), entry('b')]);
    s.select('a', 'toggle');
    s.select('b', 'toggle');
    s.select('a', 'toggle');
    expect([...s.selected]).toEqual(['b']);
  });
  it('range 从锚点到目标（按可见顺序）', () => {
    const s = new ExplorerState('t1', 1);
    s.setFiles([entry('a'), entry('b'), entry('c'), entry('d')]);
    s.select('b', 'single');       // 锚点 b
    s.select('d', 'range');        // b..d
    expect([...s.selected].sort()).toEqual(['b', 'c', 'd']);
  });
});

describe('ExplorerState 排序', () => {
  it('文件夹优先，名称升序', () => {
    const s = new ExplorerState('t1', 1);
    s.setFiles([entry('z.txt'), entry('docs', { isDir: true }), entry('a.txt')]);
    expect(s.visibleFiles().map(f => f.name)).toEqual(['docs', 'a.txt', 'z.txt']);
  });
  it('toggleSort 同列反转，文件夹仍优先', () => {
    const s = new ExplorerState('t1', 1);
    s.setFiles([entry('a.txt'), entry('b.txt'), entry('d', { isDir: true })]);
    s.toggleSort('name'); // name 已是默认升序 → 变降序
    expect(s.visibleFiles().map(f => f.name)).toEqual(['d', 'b.txt', 'a.txt']);
  });
  it('按大小排序', () => {
    const s = new ExplorerState('t1', 1);
    s.setFiles([entry('a', { size: 30 }), entry('b', { size: 10 }), entry('c', { size: 20 })]);
    s.toggleSort('size');
    expect(s.visibleFiles().map(f => f.name)).toEqual(['b', 'c', 'a']);
  });
  it('searchQuery 过滤（大小写不敏感）', () => {
    const s = new ExplorerState('t1', 1);
    s.setFiles([entry('README.md'), entry('config.yml'), entry('readme.txt')]);
    s.searchQuery = 'readme';
    expect(s.visibleFiles().map(f => f.name).sort()).toEqual(['README.md', 'readme.txt']);
  });
});

describe('ExplorerState 历史', () => {
  it('pushCurrent / stepBack / stepForward', () => {
    const s = new ExplorerState('t1', 1); // currentPath = '/'
    s.pushCurrent('/home');
    s.pushCurrent('/home/user');
    expect(s.currentPath).toBe('/home/user');
    expect(s.stepBack()).toBe('/home');
    expect(s.stepBack()).toBe('/');
    expect(s.stepBack()).toBeNull();
    expect(s.stepForward()).toBe('/home');
    expect(s.canGoForward()).toBe(true);
  });
  it('pushCurrent 清空前进栈', () => {
    const s = new ExplorerState('t1', 1);
    s.pushCurrent('/a');
    s.stepBack();              // 回到 /
    s.pushCurrent('/b');       // 新导航
    expect(s.canGoForward()).toBe(false);
  });
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`npx vitest run tests/explorer/explorer-state.test.ts`
预期：FAIL，模块不存在。

- [ ] **步骤 3：编写实现**

创建 `frontend/src/explorer/explorer-state.ts`：

```typescript
// 单标签页状态 —— 选择/排序/历史/剪贴板纯逻辑 + onChange 通知

import type { SFTPFileEntry } from './sftp-connection';

export type SortKey = 'name' | 'size' | 'modified' | 'permissions';

export interface Clipboard {
  files: SFTPFileEntry[];
  sourcePath: string;
  sourceServerId: number;
  mode: 'copy' | 'move';
}

export class ExplorerState {
  readonly tabId: string;
  serverId: number;
  currentPath = '/';
  files: SFTPFileEntry[] = [];
  history: string[] = [];
  forwardStack: string[] = [];
  selected = new Set<string>();
  lastClicked: string | null = null;
  clipboard: Clipboard | null = null;
  loading = false;
  error: string | null = null;
  sortBy: SortKey = 'name';
  sortAsc = true;
  treeCollapsed = false;
  searchQuery: string | null = null;

  private changeCbs = new Set<() => void>();

  constructor(tabId: string, serverId: number) {
    this.tabId = tabId;
    this.serverId = serverId;
  }

  // ---- 选择 ----
  select(name: string, mode: 'single' | 'toggle' | 'range'): void {
    if (mode === 'single') {
      this.selected = new Set([name]);
      this.lastClicked = name;
    } else if (mode === 'toggle') {
      if (this.selected.has(name)) this.selected.delete(name);
      else this.selected.add(name);
      this.lastClicked = name;
    } else {
      const names = this.visibleFiles().map((f) => f.name);
      const anchor = this.lastClicked ?? name;
      const i1 = names.indexOf(anchor);
      const i2 = names.indexOf(name);
      if (i1 >= 0 && i2 >= 0) {
        const [lo, hi] = i1 <= i2 ? [i1, i2] : [i2, i1];
        this.selected = new Set(names.slice(lo, hi + 1));
      }
    }
    this.notify();
  }
  selectAll(): void {
    this.selected = new Set(this.visibleFiles().map((f) => f.name));
    this.notify();
  }
  clearSelection(): void {
    this.selected.clear();
    this.lastClicked = null;
    this.notify();
  }
  getSelectedEntries(): SFTPFileEntry[] {
    return this.files.filter((f) => this.selected.has(f.name));
  }

  // ---- 文件与排序 ----
  setFiles(files: SFTPFileEntry[]): void {
    this.files = files;
    this.selected.clear();
    this.lastClicked = null;
    this.notify();
  }
  visibleFiles(): SFTPFileEntry[] {
    let list = this.files;
    if (this.searchQuery) {
      const q = this.searchQuery.toLowerCase();
      list = list.filter((f) => f.name.toLowerCase().includes(q));
    }
    const dir = this.sortAsc ? 1 : -1;
    return [...list].sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1; // 文件夹恒优先
      let cmp = 0;
      switch (this.sortBy) {
        case 'name': cmp = a.name.localeCompare(b.name); break;
        case 'size': cmp = a.size - b.size; break;
        case 'modified': cmp = a.modifiedTime - b.modifiedTime; break;
        case 'permissions': cmp = a.permissionsRaw - b.permissionsRaw; break;
      }
      return cmp * dir;
    });
  }
  toggleSort(by: SortKey): void {
    if (this.sortBy === by) this.sortAsc = !this.sortAsc;
    else { this.sortBy = by; this.sortAsc = true; }
    this.notify();
  }

  // ---- 导航历史 ----
  canGoBack(): boolean { return this.history.length > 0; }
  canGoForward(): boolean { return this.forwardStack.length > 0; }
  pushCurrent(to: string): void {
    if (to === this.currentPath) return;
    this.history.push(this.currentPath);
    this.forwardStack = [];
    this.currentPath = to;
  }
  stepBack(): string | null {
    if (!this.history.length) return null;
    this.forwardStack.push(this.currentPath);
    this.currentPath = this.history.pop()!;
    return this.currentPath;
  }
  stepForward(): string | null {
    if (!this.forwardStack.length) return null;
    this.history.push(this.currentPath);
    this.currentPath = this.forwardStack.pop()!;
    return this.currentPath;
  }

  // ---- 通知 ----
  onChange(cb: () => void): () => void {
    this.changeCbs.add(cb);
    return () => this.changeCbs.delete(cb);
  }
  notify(): void { this.changeCbs.forEach((cb) => cb()); }
}
```

- [ ] **步骤 4：运行测试验证通过**

运行：`npx vitest run tests/explorer/explorer-state.test.ts`
预期：全部 PASS（10 个用例）。

- [ ] **步骤 5：Commit**

```bash
git add frontend/src/explorer/explorer-state.ts tests/explorer/explorer-state.test.ts
git commit -m "feat(explorer): ExplorerState —— 选择/排序/历史纯逻辑状态"
```

---
### 任务 8：`explorer/explorer-actions.ts`

业务操作层：导航、CRUD、同服务器复制/移动、chmod、搜索、打开方式。IO 为主，路径拼接/命令构造/find 输出解析抽为纯函数单测。

**文件：**
- 创建：`frontend/src/explorer/explorer-actions.ts`
- 测试：`tests/explorer/actions-pure.test.ts`（新建）

设计说明：
- `ActionsContext` 注入 `openInTerminal`（打开方式 nano/vim 复用终端窗口）与 `notify`（错误提示），避免 actions 直接依赖 `wm`。
- Plan A 的 `paste()`：同服务器 `move`→`rename`、`copy`→`exec cp -r`；跨服务器仅提示"暂不支持"（Plan B 接管），接口预留。
- `goHome()` 导航到 `'.'`，依赖后端 `listDirectory` 对相对路径做 `realpath`（SFTP 会话默认 cwd 为 home）。若实测不解析 home，实现时改为缓存首次列目录的 realpath。

- [ ] **步骤 1：编写失败的测试（纯函数）**

新建 `tests/explorer/actions-pure.test.ts`：

```typescript
import { describe, it, expect } from 'vitest';
import { joinPath, buildOpenCommand, parseFindOutput } from '../../frontend/src/explorer/explorer-actions';

describe('joinPath', () => {
  it('根目录拼接不产生双斜杠', () => {
    expect(joinPath('/', 'a.txt')).toBe('/a.txt');
  });
  it('普通目录拼接', () => {
    expect(joinPath('/home/user', 'docs')).toBe('/home/user/docs');
  });
});

describe('buildOpenCommand', () => {
  it('nano 命令，单引号包裹路径', () => {
    expect(buildOpenCommand('nano', '/home/user/a.txt')).toBe("nano '/home/user/a.txt'");
  });
  it('路径含单引号时转义', () => {
    expect(buildOpenCommand('vim', "/tmp/it's.txt")).toBe("vim '/tmp/it'\\''s.txt'");
  });
});

describe('parseFindOutput', () => {
  it('把 find 输出解析为路径/名称/目录', () => {
    const out = '/home/user/a.txt\n/home/user/sub/b.log\n';
    expect(parseFindOutput(out)).toEqual([
      { path: '/home/user/a.txt', name: 'a.txt', dir: '/home/user' },
      { path: '/home/user/sub/b.log', name: 'b.log', dir: '/home/user/sub' },
    ]);
  });
  it('忽略空行', () => {
    expect(parseFindOutput('\n\n')).toEqual([]);
  });
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`npx vitest run tests/explorer/actions-pure.test.ts`
预期：FAIL，模块不存在。

- [ ] **步骤 3：编写实现**

创建 `frontend/src/explorer/explorer-actions.ts`：

```typescript
// 资源管理器业务操作 —— 导航/CRUD/复制移动/chmod/搜索/打开方式

import type { ExplorerState, SortKey } from './explorer-state';
import type { ConnectionPool } from './connection-pool';
import type { SavedServer } from '../shared/server-data';
import type { SFTPConnection } from './sftp-connection';

export interface ActionsContext {
  openInTerminal: (server: SavedServer, initialCommand: string) => void;
  notify: (message: string, variant?: 'info' | 'danger') => void;
}

export interface SearchHit { path: string; name: string; dir: string; }

/** 纯路径拼接 */
export function joinPath(base: string, name: string): string {
  return base.endsWith('/') ? base + name : base + '/' + name;
}

/** 打开方式命令构造（单引号包裹并转义内部单引号） */
export function buildOpenCommand(method: 'nano' | 'vim', path: string): string {
  const safe = `'${path.replace(/'/g, `'\\''`)}'`;
  return `${method} ${safe}`;
}

/** 解析 find 输出为搜索命中列表 */
export function parseFindOutput(out: string): SearchHit[] {
  return out.split('\n').filter((l) => l.trim().length > 0).map((p) => {
    const idx = p.lastIndexOf('/');
    return {
      path: p,
      name: idx >= 0 ? p.slice(idx + 1) : p,
      dir: idx > 0 ? p.slice(0, idx) : '/',
    };
  });
}

/** 触发浏览器下载 */
function triggerBrowserDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** shell 单引号转义 */
function shq(s: string): string { return `'${s.replace(/'/g, `'\\''`)}'`; }

export class ExplorerActions {
  constructor(
    private state: ExplorerState,
    private pool: ConnectionPool,
    private ctx: ActionsContext,
  ) {}

  private conn(): SFTPConnection {
    const c = this.pool.get(this.state.serverId);
    if (!c) throw new Error('连接不可用');
    return c;
  }

  // ---- 导航 ----
  private async loadFiles(path: string): Promise<void> {
    this.state.loading = true; this.state.error = null; this.state.notify();
    try {
      const files = await this.conn().listDirectory(path);
      this.state.setFiles(files);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.state.error = msg;
      this.ctx.notify(msg, 'danger');
    } finally {
      this.state.loading = false; this.state.notify();
    }
  }
  async navigate(path: string): Promise<void> { this.state.pushCurrent(path); await this.loadFiles(path); }
  async goBack(): Promise<void> { const t = this.state.stepBack(); if (t !== null) await this.loadFiles(t); }
  async goForward(): Promise<void> { const t = this.state.stepForward(); if (t !== null) await this.loadFiles(t); }
  async goHome(): Promise<void> { await this.navigate('.'); }
  async refresh(): Promise<void> { await this.loadFiles(this.state.currentPath); }

  // ---- 剪贴板 ----
  copy(): void { this.setClipboard('copy'); }
  cut(): void { this.setClipboard('move'); }
  private setClipboard(mode: 'copy' | 'move'): void {
    const files = this.state.getSelectedEntries();
    if (!files.length) return;
    this.state.clipboard = {
      files, sourcePath: this.state.currentPath,
      sourceServerId: this.state.serverId, mode,
    };
    this.ctx.notify(`已${mode === 'copy' ? '复制' : '剪切'} ${files.length} 项`);
  }
  async paste(): Promise<void> {
    const cb = this.state.clipboard;
    if (!cb) return;
    if (cb.sourceServerId !== this.state.serverId) {
      this.ctx.notify('跨服务器传输将在后续版本支持', 'danger');
      return;
    }
    const conn = this.conn();
    try {
      for (const f of cb.files) {
        const src = joinPath(cb.sourcePath, f.name);
        const dst = joinPath(this.state.currentPath, f.name);
        if (src === dst) continue;
        if (cb.mode === 'move') await conn.rename(src, dst);
        else await conn.exec(`cp -r ${shq(src)} ${shq(dst)}`);
      }
      if (cb.mode === 'move') this.state.clipboard = null;
      await this.refresh();
    } catch (e) {
      this.ctx.notify(e instanceof Error ? e.message : String(e), 'danger');
    }
  }

  // ---- CRUD ----
  async upload(files: FileList): Promise<void> {
    const conn = this.conn();
    try {
      for (const f of Array.from(files)) {
        await conn.uploadFile(joinPath(this.state.currentPath, f.name), f);
      }
      await this.refresh();
    } catch (e) {
      this.ctx.notify(e instanceof Error ? e.message : String(e), 'danger');
    }
  }
  async download(): Promise<void> {
    const conn = this.conn();
    for (const f of this.state.getSelectedEntries()) {
      if (f.isDir) continue;
      try {
        const blob = await conn.downloadFile(joinPath(this.state.currentPath, f.name));
        triggerBrowserDownload(blob, f.name);
      } catch (e) {
        this.ctx.notify(e instanceof Error ? e.message : String(e), 'danger');
      }
    }
  }
  async delete(): Promise<void> {
    const conn = this.conn();
    try {
      for (const f of this.state.getSelectedEntries()) {
        const p = joinPath(this.state.currentPath, f.name);
        if (f.isDir) await conn.deleteDirectory(p);
        else await conn.deleteFile(p);
      }
      await this.refresh();
    } catch (e) {
      this.ctx.notify(e instanceof Error ? e.message : String(e), 'danger');
    }
  }
  async rename(oldName: string, newName: string): Promise<void> {
    try {
      await this.conn().rename(
        joinPath(this.state.currentPath, oldName),
        joinPath(this.state.currentPath, newName),
      );
      await this.refresh();
    } catch (e) {
      this.ctx.notify(e instanceof Error ? e.message : String(e), 'danger');
    }
  }
  async mkdir(name: string): Promise<void> {
    try {
      await this.conn().mkdir(joinPath(this.state.currentPath, name));
      await this.refresh();
    } catch (e) {
      this.ctx.notify(e instanceof Error ? e.message : String(e), 'danger');
    }
  }
  async chmod(name: string, mode: number): Promise<void> {
    try {
      await this.conn().chmod(joinPath(this.state.currentPath, name), mode);
      await this.refresh();
    } catch (e) {
      this.ctx.notify(e instanceof Error ? e.message : String(e), 'danger');
    }
  }

  // ---- 搜索 ----
  filter(query: string): void {
    this.state.searchQuery = query.trim() || null;
    this.state.notify();
  }
  async search(query: string): Promise<SearchHit[]> {
    const cur = this.state.currentPath;
    const cmd = `find ${shq(cur)} -maxdepth 5 -iname ${shq('*' + query + '*')} 2>/dev/null | head -200`;
    const out = await this.conn().exec(cmd);
    return parseFindOutput(out);
  }

  // ---- 打开方式 ----
  async openWith(name: string, method: 'nano' | 'vim' | 'download'): Promise<void> {
    const path = joinPath(this.state.currentPath, name);
    if (method === 'download') {
      try {
        const blob = await this.conn().downloadFile(path);
        triggerBrowserDownload(blob, name);
      } catch (e) {
        this.ctx.notify(e instanceof Error ? e.message : String(e), 'danger');
      }
      return;
    }
    const server = this.pool.getServer(this.state.serverId);
    if (server) this.ctx.openInTerminal(server, buildOpenCommand(method, path));
  }

  // ---- 排序 ----
  sort(by: SortKey): void { this.state.toggleSort(by); }
}
```

- [ ] **步骤 4：运行测试验证通过**

运行：`npx vitest run tests/explorer/actions-pure.test.ts`
预期：全部 PASS（6 个用例）。

- [ ] **步骤 5：编译校验 + Commit**

运行：`npx tsc --noEmit -p tsconfig.json`
预期：无类型错误。

```bash
git add frontend/src/explorer/explorer-actions.ts tests/explorer/actions-pure.test.ts
git commit -m "feat(explorer): ExplorerActions —— 导航/CRUD/复制移动/搜索/打开方式"
```

---
## Part 5 — 标签管理

### 任务 9：`explorer/tab-manager.ts`

标签页 CRUD 与切换。标签标题计算、关闭后 active 选择抽为纯函数单测；连接 IO 走手动验证。多连接语义：`closeTab` 仅 `release` 引用计数，不自动断开（连接保留在池/树中，符合多连接设计，断开由树面板显式触发）。

**文件：**
- 创建：`frontend/src/explorer/tab-manager.ts`
- 测试：`tests/explorer/tab-logic.test.ts`（新建）

- [ ] **步骤 1：编写失败的测试（纯函数）**

新建 `tests/explorer/tab-logic.test.ts`：

```typescript
import { describe, it, expect } from 'vitest';
import { tabTitle, nextActiveAfterClose } from '../../frontend/src/explorer/tab-manager';

describe('tabTitle', () => {
  it('根目录显示 服务器名:/', () => {
    expect(tabTitle('开发机', '/')).toBe('开发机:/');
  });
  it('深层目录取末段', () => {
    expect(tabTitle('生产机', '/var/log/nginx')).toBe('生产机:nginx');
  });
});

describe('nextActiveAfterClose', () => {
  it('关闭非当前标签，active 不变', () => {
    expect(nextActiveAfterClose(['a', 'b', 'c'], 'a', 'b')).toBe('b');
  });
  it('关闭当前标签，选原位置的后一个', () => {
    expect(nextActiveAfterClose(['a', 'b', 'c'], 'b', 'b')).toBe('c');
  });
  it('关闭最后一个当前标签，选前一个', () => {
    expect(nextActiveAfterClose(['a', 'b', 'c'], 'c', 'c')).toBe('b');
  });
  it('关闭唯一标签，返回 null', () => {
    expect(nextActiveAfterClose(['a'], 'a', 'a')).toBeNull();
  });
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`npx vitest run tests/explorer/tab-logic.test.ts`
预期：FAIL，模块不存在。

- [ ] **步骤 3：编写实现**

创建 `frontend/src/explorer/tab-manager.ts`：

```typescript
// 标签页管理 —— CRUD、切换、拖出为独立窗口

import { ExplorerState } from './explorer-state';
import { ExplorerActions, type ActionsContext } from './explorer-actions';
import type { ConnectionPool } from './connection-pool';
import type { SavedServer } from '../shared/server-data';

export interface Tab {
  id: string;
  serverId: number;
  state: ExplorerState;
  actions: ExplorerActions;
}

/** 标签标题：服务器名:当前目录末段（纯逻辑） */
export function tabTitle(serverName: string, path: string): string {
  const base = path === '/' ? '/' : (path.split('/').filter(Boolean).pop() || '/');
  return `${serverName}:${base}`;
}

/** 关闭标签后应激活哪个（纯逻辑） */
export function nextActiveAfterClose(
  ids: string[], closingId: string, currentActive: string,
): string | null {
  if (closingId !== currentActive) return currentActive;
  const idx = ids.indexOf(closingId);
  const remaining = ids.filter((id) => id !== closingId);
  if (!remaining.length) return null;
  return remaining[Math.min(idx, remaining.length - 1)];
}

export class TabManager {
  private tabs: Tab[] = [];
  private activeId: string | null = null;
  private seq = 0;
  private changeCbs = new Set<() => void>();

  constructor(private pool: ConnectionPool, private ctx: ActionsContext) {}

  /** 新建标签并连接服务器（复用池内连接） */
  async createTab(server: SavedServer): Promise<Tab> {
    await this.pool.connect(server);
    this.pool.acquire(server.id);
    const id = `tab-${++this.seq}`;
    const state = new ExplorerState(id, server.id);
    const actions = new ExplorerActions(state, this.pool, this.ctx);
    const tab: Tab = { id, serverId: server.id, state, actions };
    this.tabs.push(tab);
    this.activeId = id;
    this.notify();
    void actions.goHome();
    return tab;
  }

  closeTab(tabId: string): void {
    const tab = this.tabs.find((t) => t.id === tabId);
    if (!tab) return;
    const ids = this.tabs.map((t) => t.id);
    this.activeId = nextActiveAfterClose(ids, tabId, this.activeId ?? '');
    this.tabs = this.tabs.filter((t) => t.id !== tabId);
    this.pool.release(tab.serverId); // 仅减引用，连接保留在池中
    this.notify();
  }

  switchTab(tabId: string): void {
    if (this.tabs.some((t) => t.id === tabId)) { this.activeId = tabId; this.notify(); }
  }
  getActiveTab(): Tab | null { return this.tabs.find((t) => t.id === this.activeId) ?? null; }
  getAllTabs(): Tab[] { return [...this.tabs]; }
  count(): number { return this.tabs.length; }

  onChange(cb: () => void): () => void {
    this.changeCbs.add(cb);
    return () => this.changeCbs.delete(cb);
  }
  private notify(): void { this.changeCbs.forEach((cb) => cb()); }

  dispose(): void {
    this.tabs.forEach((t) => this.pool.release(t.serverId));
    this.tabs = [];
    this.activeId = null;
    this.changeCbs.clear();
  }
}
```

- [ ] **步骤 4：运行测试验证通过**

运行：`npx vitest run tests/explorer/tab-logic.test.ts`
预期：全部 PASS（6 个用例）。

- [ ] **步骤 5：编译校验 + Commit**

运行：`npx tsc --noEmit -p tsconfig.json`
预期：无类型错误。

```bash
git add frontend/src/explorer/tab-manager.ts tests/explorer/tab-logic.test.ts
git commit -m "feat(explorer): TabManager —— 标签页 CRUD 与切换"
```

---
## Part 6 — UI 组件

> UI 组件在 vitest node 环境无法单测（无 DOM，且现有代码库不引入 jsdom）。本部分给出完整实现 + 详细手动验证步骤。构建校验统一用 `npx tsc --noEmit` 与 `npm run build:frontend`。

### 任务 10：`explorer/context-menu.ts`

通用弹出菜单渲染器，支持二级子菜单（"打开方式"）。菜单项数组由调用方（desktop/mobile）构造。

**文件：**
- 创建：`frontend/src/explorer/context-menu.ts`

- [ ] **步骤 1：编写实现**

创建 `frontend/src/explorer/context-menu.ts`：

```typescript
// 通用弹出菜单 —— 右键(桌面)/竖三点(移动)，支持二级子菜单

export interface MenuItem {
  label: string;
  icon?: string;           // material symbol 名
  danger?: boolean;
  disabled?: boolean;
  submenu?: MenuItem[];
  onClick?: () => void;
}

let activeMenu: HTMLElement | null = null;

export function closeContextMenu(): void {
  activeMenu?.remove();
  activeMenu = null;
  document.removeEventListener('click', onDocClick, true);
  document.removeEventListener('keydown', onKeydown, true);
}

function onDocClick(e: MouseEvent): void {
  if (activeMenu && !activeMenu.contains(e.target as Node)) closeContextMenu();
}
function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') closeContextMenu();
}

function renderItems(items: MenuItem[]): HTMLElement {
  const ul = document.createElement('div');
  ul.className = 'py-1 min-w-[160px] bg-elevated border border-outline-variant rounded shadow-lg text-xs text-on-surface';
  for (const item of items) {
    const row = document.createElement('div');
    row.className = [
      'flex items-center gap-2 px-3 py-1.5 cursor-pointer select-none relative',
      item.disabled ? 'opacity-30 pointer-events-none' : 'hover:bg-surface-variant',
      item.danger ? 'text-error' : '',
    ].join(' ');
    row.innerHTML = `
      ${item.icon ? `<span class="material-symbols-outlined" style="font-size:15px;">${item.icon}</span>` : '<span style="width:15px;"></span>'}
      <span class="flex-1">${item.label}</span>
      ${item.submenu ? '<span class="material-symbols-outlined" style="font-size:15px;">chevron_right</span>' : ''}
    `;
    if (item.submenu) {
      const sub = renderItems(item.submenu);
      sub.style.cssText = 'position:absolute;left:100%;top:0;display:none;';
      row.appendChild(sub);
      row.addEventListener('mouseenter', () => { sub.style.display = 'block'; });
      row.addEventListener('mouseleave', () => { sub.style.display = 'none'; });
    } else if (item.onClick) {
      row.addEventListener('click', (e) => {
        e.stopPropagation();
        item.onClick!();
        closeContextMenu();
      });
    }
    ul.appendChild(row);
  }
  return ul;
}

/** 在 (x, y) 弹出菜单，自动避让视口边缘 */
export function showContextMenu(x: number, y: number, items: MenuItem[]): void {
  closeContextMenu();
  const menu = renderItems(items);
  menu.style.cssText = 'position:fixed;z-index:1000;';
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  document.body.appendChild(menu);
  activeMenu = menu;

  // 边缘避让
  const rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth) menu.style.left = `${window.innerWidth - rect.width - 4}px`;
  if (rect.bottom > window.innerHeight) menu.style.top = `${window.innerHeight - rect.height - 4}px`;

  setTimeout(() => {
    document.addEventListener('click', onDocClick, true);
    document.addEventListener('keydown', onKeydown, true);
  }, 0);
}
```

- [ ] **步骤 2：编译校验**

运行：`npx tsc --noEmit -p tsconfig.json`
预期：无类型错误。

- [ ] **步骤 3：Commit**

```bash
git add frontend/src/explorer/context-menu.ts
git commit -m "feat(explorer): 通用上下文菜单（含二级子菜单）"
```

---

### 任务 11：`explorer/server-picker.ts`

服务器选择页：进入资源管理器或新建标签时展示已保存服务器列表。

**文件：**
- 创建：`frontend/src/explorer/server-picker.ts`

- [ ] **步骤 1：编写实现**

创建 `frontend/src/explorer/server-picker.ts`：

```typescript
// 服务器选择页 —— 复用已保存服务器数据

import { fetchSavedServers, type SavedServer } from '../shared/server-data';
import { t } from '../i18n';

export interface ServerPickerOptions {
  container: HTMLElement;
  connectedIds: Set<number>;               // 已连接服务器高亮"已连接"
  onPick: (server: SavedServer) => void;
  onError?: (message: string) => void;
}

/** 渲染服务器选择页到容器 */
export async function renderServerPicker(opts: ServerPickerOptions): Promise<void> {
  const { container } = opts;
  container.innerHTML = `
    <div class="p-6 text-on-surface">
      <div class="text-xs font-bold tracking-[0.1em] text-primary-container mb-4" data-i18n="explorer.connect">${t('explorer.connect')}</div>
      <div id="ep-server-list" class="grid grid-cols-1 sm:grid-cols-2 gap-3"></div>
      <div id="ep-empty" class="hidden text-xs text-on-surface-variant py-8 text-center"></div>
    </div>
  `;
  const list = container.querySelector('#ep-server-list') as HTMLElement;
  const empty = container.querySelector('#ep-empty') as HTMLElement;

  let servers: SavedServer[] = [];
  try {
    servers = await fetchSavedServers();
  } catch (e) {
    opts.onError?.(e instanceof Error ? e.message : String(e));
    return;
  }

  if (!servers.length) {
    list.classList.add('hidden');
    empty.classList.remove('hidden');
    empty.textContent = t('explorer.noServers');
    return;
  }

  list.innerHTML = servers.map((s) => `
    <button class="ep-card text-left p-4 border border-outline-variant rounded hover:border-primary-container transition-colors cursor-pointer" data-id="${s.id}">
      <div class="flex items-center gap-2 mb-1">
        <span class="material-symbols-outlined text-primary" style="font-size:18px;">dns</span>
        <span class="text-sm font-bold">${escapeHtml(s.name)}</span>
        ${opts.connectedIds.has(s.id) ? '<span class="ml-auto w-2 h-2 rounded-full bg-primary-container"></span>' : ''}
      </div>
      <div class="text-[11px] text-on-surface-variant">${escapeHtml(s.username)}@${escapeHtml(s.host)}:${s.port}</div>
    </button>
  `).join('');

  servers.forEach((s) => {
    const el = list.querySelector(`.ep-card[data-id="${s.id}"]`);
    el?.addEventListener('click', () => opts.onPick(s));
  });
}

function escapeHtml(s: string): string {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}
```

- [ ] **步骤 2：确认 i18n 键将在任务 16 补充**

`explorer.connect` / `explorer.noServers` 在任务 16 统一加入 locale 文件。此处先使用，任务 16 补齐（届时 `t()` 返回键名占位不影响编译）。

- [ ] **步骤 3：编译校验 + Commit**

运行：`npx tsc --noEmit -p tsconfig.json`
预期：无类型错误。

```bash
git add frontend/src/explorer/server-picker.ts
git commit -m "feat(explorer): 服务器选择页 server-picker"
```

---
### 任务 12：`explorer/desktop-explorer.ts`

桌面主布局：标签栏 + 工具栏（导航/面包屑/搜索）+ lazy 目录树 + 详细列表 + 状态栏。同时导出 `showChmodDialog`（移动端复用）。

**文件：**
- 创建：`frontend/src/explorer/desktop-explorer.ts`

渲染分层（避免搜索框因列表刷新丢焦点）：
- `render()` 全量建骨架（标签栏/工具栏/树/列表容器/状态栏）+ 订阅 active tab 的 state；`tabs`/`pool` 变化触发 `render()`。
- `renderList()` 只重绘列表容器；active tab 的 `state.onChange` 触发 `renderList()`。
- DOM 容器 id 契约：`#ex-tabbar` `#ex-toolbar` `#ex-crumb` `#ex-search` `#ex-tree` `#ex-list` `#ex-status`。
- 所有可视样式沿用 `sftp-panel.ts` 的 Tailwind + Material 语义色（`bg-surface` / `text-on-surface` / `border-outline-variant` 等）。

- [ ] **步骤 1：类骨架、依赖类型与 render 主结构**

创建 `frontend/src/explorer/desktop-explorer.ts`：

```typescript
// 桌面资源管理器布局

import type { TabManager } from './tab-manager';
import { tabTitle } from './tab-manager';
import type { ConnectionPool } from './connection-pool';
import type { SavedServer } from '../shared/server-data';
import type { SFTPFileEntry } from './sftp-connection';
import { showContextMenu, closeContextMenu, type MenuItem } from './context-menu';
import { t } from '../i18n';
import { requestText, confirmAction } from '../ui-feedback';

export interface ExplorerUICtx {
  allServers: () => SavedServer[];                 // 全部已保存服务器（树用）
  onNewTab: () => void;                            // [+] 新建标签（弹服务器选择）
  onConnectServer: (server: SavedServer) => void;  // 树上点未连接服务器
  onDetachTab: (tabId: string) => void;            // 拖出标签为独立窗口
  onDisconnectServer: (serverId: number) => void;  // 树上断开服务器
}

function escapeHtml(s: string): string {
  const d = document.createElement('div'); d.textContent = s; return d.innerHTML;
}
function formatTime(sec: number): string {
  if (!sec) return '';
  const d = new Date(sec * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export class DesktopExplorer {
  private offCbs: (() => void)[] = [];
  private activeStateOff: (() => void) | null = null;
  // lazy 目录树状态
  private treeExpanded = new Map<number, Set<string>>();   // serverId → 已展开目录
  private treeChildren = new Map<string, SFTPFileEntry[]>(); // `${sid}:${path}` → 子目录缓存

  constructor(
    private root: HTMLElement,
    private tabs: TabManager,
    private pool: ConnectionPool,
    private ui: ExplorerUICtx,
  ) {
    this.offCbs.push(this.tabs.onChange(() => this.render()));
    this.offCbs.push(this.pool.onChange(() => this.render()));
  }

  render(): void {
    const active = this.tabs.getActiveTab();
    this.root.innerHTML = `
      <div class="flex flex-col h-full bg-surface text-on-surface text-xs">
        <div id="ex-tabbar" class="flex items-center gap-1 px-2 h-9 border-b border-outline-variant bg-elevated shrink-0 overflow-x-auto"></div>
        <div id="ex-toolbar" class="flex items-center gap-2 px-2 h-9 border-b border-outline-variant shrink-0"></div>
        <div class="flex flex-1 min-h-0">
          <div id="ex-tree" class="w-52 shrink-0 border-r border-outline-variant overflow-auto p-1"></div>
          <div id="ex-list" class="flex-1 overflow-auto"></div>
        </div>
        <div id="ex-status" class="flex items-center justify-between px-3 h-6 border-t border-outline-variant text-[11px] text-on-surface-variant shrink-0"></div>
      </div>
    `;
    this.renderTabBar();
    this.renderToolbar();
    this.renderTree();
    this.renderList();
    this.renderStatus();

    // 订阅 active tab 状态 → 局部重绘列表/状态/工具栏（面包屑）
    this.activeStateOff?.();
    this.activeStateOff = active
      ? active.state.onChange(() => { this.renderToolbar(); this.renderList(); this.renderStatus(); })
      : null;
  }

  dispose(): void {
    this.activeStateOff?.();
    this.offCbs.forEach((f) => f());
    closeContextMenu();
    this.root.innerHTML = '';
  }
```

- [ ] **步骤 2：标签栏与工具栏（含面包屑、搜索）**

追加（类内）：

```typescript
  private renderTabBar(): void {
    const bar = this.root.querySelector('#ex-tabbar') as HTMLElement;
    if (!bar) return;
    const active = this.tabs.getActiveTab();
    bar.innerHTML = this.tabs.getAllTabs().map((tab) => {
      const server = this.pool.getServer(tab.serverId);
      const title = tabTitle(server?.name ?? '?', tab.state.currentPath);
      const on = tab.id === active?.id;
      return `<div class="ex-tab flex items-center gap-1 px-2 py-1 rounded cursor-pointer ${on ? 'bg-surface-variant text-on-surface' : 'text-on-surface-variant hover:bg-surface-variant'}" draggable="true" data-id="${tab.id}">
        <span class="truncate max-w-[140px]">${escapeHtml(title)}</span>
        <span class="ex-tab-close material-symbols-outlined hover:text-error" style="font-size:14px;" data-id="${tab.id}">close</span>
      </div>`;
    }).join('') + `<button id="ex-tab-add" class="px-2 py-1 hover:bg-surface-variant rounded" title="${t('explorer.newTab')}"><span class="material-symbols-outlined" style="font-size:16px;">add</span></button>`;

    bar.querySelectorAll('.ex-tab').forEach((el) => {
      const id = (el as HTMLElement).dataset.id!;
      el.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).classList.contains('ex-tab-close')) return;
        this.tabs.switchTab(id);
      });
      el.addEventListener('auxclick', (e) => { if ((e as MouseEvent).button === 1) this.tabs.closeTab(id); });
      el.addEventListener('dragend', (e) => {
        // 拖到标签栏外 → 拖出为独立窗口
        const barRect = bar.getBoundingClientRect();
        const me = e as DragEvent;
        if (me.clientY > barRect.bottom + 40 || me.clientY < barRect.top - 40) this.ui.onDetachTab(id);
      });
    });
    bar.querySelectorAll('.ex-tab-close').forEach((el) =>
      el.addEventListener('click', (e) => { e.stopPropagation(); this.tabs.closeTab((el as HTMLElement).dataset.id!); }));
    bar.querySelector('#ex-tab-add')?.addEventListener('click', () => this.ui.onNewTab());
  }

  private renderToolbar(): void {
    const tb = this.root.querySelector('#ex-toolbar') as HTMLElement;
    const active = this.tabs.getActiveTab();
    if (!tb) return;
    if (!active) { tb.innerHTML = ''; return; }
    const st = active.state;
    tb.innerHTML = `
      <button class="ex-nav p-1 rounded hover:bg-surface-variant ${st.canGoBack() ? '' : 'opacity-30 pointer-events-none'}" data-act="back" title="${t('explorer.back')}"><span class="material-symbols-outlined" style="font-size:16px;">arrow_back</span></button>
      <button class="ex-nav p-1 rounded hover:bg-surface-variant ${st.canGoForward() ? '' : 'opacity-30 pointer-events-none'}" data-act="forward"><span class="material-symbols-outlined" style="font-size:16px;">arrow_forward</span></button>
      <button class="ex-nav p-1 rounded hover:bg-surface-variant" data-act="up" title="${t('explorer.up')}"><span class="material-symbols-outlined" style="font-size:16px;">arrow_upward</span></button>
      <button class="ex-nav p-1 rounded hover:bg-surface-variant" data-act="home"><span class="material-symbols-outlined" style="font-size:16px;">home</span></button>
      <button class="ex-nav p-1 rounded hover:bg-surface-variant" data-act="refresh"><span class="material-symbols-outlined" style="font-size:16px;">refresh</span></button>
      <div id="ex-crumb" class="flex-1 flex items-center flex-wrap px-2 overflow-hidden"></div>
      <input id="ex-search" class="terminal-input text-[12px] px-2 py-1 w-40" placeholder="${t('explorer.search')}" value="${st.searchQuery ?? ''}" />
    `;
    // 面包屑
    const crumb = tb.querySelector('#ex-crumb') as HTMLElement;
    crumb.innerHTML = this.breadcrumb(st.currentPath);
    crumb.querySelectorAll('.ex-crumb').forEach((el) =>
      el.addEventListener('click', () => active.actions.navigate((el as HTMLElement).dataset.path!)));
    // 导航按钮
    tb.querySelectorAll('.ex-nav').forEach((el) => el.addEventListener('click', () => {
      const act = (el as HTMLElement).dataset.act;
      if (act === 'back') void active.actions.goBack();
      else if (act === 'forward') void active.actions.goForward();
      else if (act === 'up') { const p = st.currentPath.replace(/\/[^/]+\/?$/, '') || '/'; void active.actions.navigate(p); }
      else if (act === 'home') void active.actions.goHome();
      else if (act === 'refresh') void active.actions.refresh();
    }));
    // 搜索：即时过滤 + 回车远程搜索
    const search = tb.querySelector('#ex-search') as HTMLInputElement;
    search.addEventListener('input', () => active.actions.filter(search.value));
    search.addEventListener('keydown', async (e) => {
      if ((e as KeyboardEvent).key === 'Enter' && search.value.trim()) {
        const hits = await active.actions.search(search.value.trim());
        this.showSearchResults(hits);
      }
    });
  }

  private breadcrumb(path: string): string {
    const parts = path.split('/').filter(Boolean);
    let acc = '';
    const segs = [`<span class="ex-crumb cursor-pointer hover:text-primary-container" data-path="/">/</span>`];
    for (const p of parts) {
      acc += '/' + p;
      segs.push(`<span class="ex-crumb cursor-pointer hover:text-primary-container" data-path="${acc}">${escapeHtml(p)}</span>`);
    }
    return segs.join('<span class="text-on-surface-variant mx-0.5">/</span>');
  }
```

- [ ] **步骤 3：lazy 目录树**

追加（类内）。树列出全部已保存服务器，已连接的可展开、lazy 加载子目录：

```typescript
  private renderTree(): void {
    const tree = this.root.querySelector('#ex-tree') as HTMLElement;
    if (!tree) return;
    const active = this.tabs.getActiveTab();
    tree.innerHTML = this.ui.allServers().map((s) => {
      const connected = this.pool.isConnected(s.id);
      const dot = connected ? '<span class="w-1.5 h-1.5 rounded-full bg-primary-container"></span>' : '<span class="w-1.5 h-1.5 rounded-full border border-outline-variant"></span>';
      const expanded = connected && this.treeExpanded.has(s.id);
      const childrenHtml = expanded ? this.renderTreeChildren(s.id, active?.state.currentPath ?? '/') : '';
      return `<div>
        <div class="ex-srv flex items-center gap-1 px-1 py-0.5 rounded cursor-pointer hover:bg-surface-variant" data-sid="${s.id}">
          ${connected ? `<span class="ex-srv-toggle material-symbols-outlined" style="font-size:14px;" data-sid="${s.id}">${expanded ? 'expand_more' : 'chevron_right'}</span>` : '<span style="width:14px;"></span>'}
          ${dot}<span class="truncate flex-1">${escapeHtml(s.name)}</span>
        </div>
        <div class="ml-3">${childrenHtml}</div>
      </div>`;
    }).join('');

    // 服务器行：未连接→连接；已连接→切当前标签到 home 并展开
    tree.querySelectorAll('.ex-srv').forEach((el) => el.addEventListener('click', async (e) => {
      if ((e.target as HTMLElement).classList.contains('ex-srv-toggle')) return;
      const sid = Number((el as HTMLElement).dataset.sid);
      const server = this.ui.allServers().find((s) => s.id === sid)!;
      if (!this.pool.isConnected(sid)) { this.ui.onConnectServer(server); return; }
      if (active && active.serverId === sid) return;
    }));
    tree.querySelectorAll('.ex-srv-toggle').forEach((el) => el.addEventListener('click', async (e) => {
      e.stopPropagation();
      const sid = Number((el as HTMLElement).dataset.sid);
      await this.toggleServerTree(sid);
    }));
    tree.querySelectorAll('.ex-tnode').forEach((el) => {
      const sid = Number((el as HTMLElement).dataset.sid);
      const path = (el as HTMLElement).dataset.path!;
      el.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).classList.contains('ex-tnode-toggle')) return;
        if (active && active.serverId === sid) void active.actions.navigate(path);
      });
    });
    tree.querySelectorAll('.ex-tnode-toggle').forEach((el) => el.addEventListener('click', async (e) => {
      e.stopPropagation();
      const sid = Number((el as HTMLElement).dataset.sid);
      await this.toggleTreeDir(sid, (el as HTMLElement).dataset.path!);
    }));
  }

  private renderTreeChildren(sid: number, _cur: string): string {
    const set = this.treeExpanded.get(sid);
    if (!set) return '';
    // 只渲染已展开根（home '.'）的一层，递归由 treeExpanded 中的路径决定
    return this.renderTreeLevel(sid, '.', 0);
  }
  private renderTreeLevel(sid: number, path: string, depth: number): string {
    if (depth > 8) return '';
    const dirs = this.treeChildren.get(`${sid}:${path}`) || [];
    return dirs.map((d) => {
      const childPath = path === '.' ? d.name : `${path}/${d.name}`;
      const isExp = this.treeExpanded.get(sid)?.has(childPath);
      return `<div>
        <div class="ex-tnode flex items-center gap-1 px-1 py-0.5 rounded cursor-pointer hover:bg-surface-variant" data-sid="${sid}" data-path="${escapeHtml(childPath)}">
          <span class="ex-tnode-toggle material-symbols-outlined" style="font-size:13px;" data-sid="${sid}" data-path="${escapeHtml(childPath)}">${isExp ? 'expand_more' : 'chevron_right'}</span>
          <span class="material-symbols-outlined" style="font-size:13px;">folder</span>
          <span class="truncate">${escapeHtml(d.name)}</span>
        </div>
        ${isExp ? `<div class="ml-3">${this.renderTreeLevel(sid, childPath, depth + 1)}</div>` : ''}
      </div>`;
    }).join('');
  }

  private async toggleServerTree(sid: number): Promise<void> {
    if (this.treeExpanded.has(sid)) { this.treeExpanded.delete(sid); this.renderTree(); return; }
    this.treeExpanded.set(sid, new Set(['.']));
    await this.loadTreeDir(sid, '.');
    this.renderTree();
  }
  private async toggleTreeDir(sid: number, path: string): Promise<void> {
    const set = this.treeExpanded.get(sid) ?? new Set<string>();
    if (set.has(path)) { set.delete(path); this.treeExpanded.set(sid, set); this.renderTree(); return; }
    set.add(path); this.treeExpanded.set(sid, set);
    await this.loadTreeDir(sid, path);
    this.renderTree();
  }
  private async loadTreeDir(sid: number, path: string): Promise<void> {
    const conn = this.pool.get(sid);
    if (!conn) return;
    try {
      const entries = await conn.listDirectory(path);
      this.treeChildren.set(`${sid}:${path}`, entries.filter((e) => e.isDir && e.name !== '.' && e.name !== '..'));
    } catch { /* 忽略树加载失败 */ }
  }
```

- [ ] **步骤 4：文件列表与行交互（选中/双击/右键菜单）**

追加（类内）：

```typescript
  private renderList(): void {
    const list = this.root.querySelector('#ex-list') as HTMLElement;
    const active = this.tabs.getActiveTab();
    if (!list) return;
    if (!active) { list.innerHTML = `<div class="p-6 text-on-surface-variant">${t('explorer.noTab')}</div>`; return; }
    const st = active.state;
    const cols = (key: string, label: string) =>
      `<div class="ex-col cursor-pointer hover:text-primary-container ${st.sortBy === key ? 'text-primary-container' : ''}" data-key="${key}">${label}${st.sortBy === key ? (st.sortAsc ? ' ▲' : ' ▼') : ''}</div>`;
    const rows = st.visibleFiles().map((f) => this.renderRow(f, st.selected.has(f.name))).join('');
    list.innerHTML = `
      <div class="grid grid-cols-[1fr_90px_110px_130px] px-2 py-1 border-b border-outline-variant sticky top-0 bg-surface font-bold text-on-surface-variant">
        ${cols('name', t('explorer.name'))}${cols('size', t('explorer.size'))}${cols('permissions', t('explorer.perms'))}${cols('modified', t('explorer.modified'))}
      </div>
      <div id="ex-rows">${rows || `<div class="p-6 text-on-surface-variant">${t('explorer.empty')}</div>`}</div>
    `;
    // 列头排序
    list.querySelectorAll('.ex-col').forEach((el) =>
      el.addEventListener('click', () => active.actions.sort((el as HTMLElement).dataset.key as any)));
    // 行事件（委托）
    list.querySelectorAll('.ex-row').forEach((el) => this.bindRow(el as HTMLElement, active));
    // 空白右键
    (list.querySelector('#ex-rows') as HTMLElement).addEventListener('contextmenu', (e) => {
      if ((e.target as HTMLElement).closest('.ex-row')) return;
      e.preventDefault();
      this.blankMenu(e as MouseEvent, active);
    });
    // 拖拽上传
    list.addEventListener('dragover', (e) => e.preventDefault());
    list.addEventListener('drop', (e) => {
      e.preventDefault();
      const files = (e as DragEvent).dataTransfer?.files;
      if (files?.length) void active.actions.upload(files);
    });
  }

  private renderRow(f: SFTPFileEntry, selected: boolean): string {
    const icon = f.isDir ? 'folder' : (f.isLink ? 'link' : 'description');
    return `<div class="ex-row grid grid-cols-[1fr_90px_110px_130px] items-center px-2 py-1 select-none ${selected ? 'bg-primary-container/20' : 'hover:bg-surface-variant'}" data-name="${escapeHtml(f.name)}">
      <div class="flex items-center gap-2 truncate"><span class="material-symbols-outlined" style="font-size:16px;">${icon}</span><span class="truncate">${escapeHtml(f.name)}</span></div>
      <div class="text-right text-on-surface-variant pr-2">${f.isDir ? '' : f.sizeFormatted}</div>
      <div class="font-mono text-[11px] text-on-surface-variant">${f.permissions}</div>
      <div class="text-[11px] text-on-surface-variant">${formatTime(f.modifiedTime)}</div>
    </div>`;
  }

  private bindRow(el: HTMLElement, active: NonNullable<ReturnType<TabManager['getActiveTab']>>): void {
    const name = el.dataset.name!;
    const entry = () => active.state.files.find((f) => f.name === name)!;
    el.addEventListener('click', (e) => {
      const mode = e.ctrlKey || e.metaKey ? 'toggle' : e.shiftKey ? 'range' : 'single';
      active.state.select(name, mode);
    });
    el.addEventListener('dblclick', (e) => {
      const f = entry();
      if (f.isDir) void active.actions.navigate(active.state.currentPath.replace(/\/$/, '') + '/' + f.name);
      else this.openWithMenu((e as MouseEvent).clientX, (e as MouseEvent).clientY, name);
    });
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (!active.state.selected.has(name)) active.state.select(name, 'single');
      this.fileMenu(e as MouseEvent, active, entry());
    });
  }

  private openWithMenu(x: number, y: number, name: string): void {
    const active = this.tabs.getActiveTab(); if (!active) return;
    showContextMenu(x, y, [this.openWithItem(active, name)]);
  }
  private openWithItem(active: NonNullable<ReturnType<TabManager['getActiveTab']>>, name: string): MenuItem {
    return {
      label: t('explorer.openWith'), icon: 'open_in_new', submenu: [
        { label: 'nano', icon: 'edit', onClick: () => void active.actions.openWith(name, 'nano') },
        { label: 'vim', icon: 'edit', onClick: () => void active.actions.openWith(name, 'vim') },
        { label: t('explorer.download'), icon: 'download', onClick: () => void active.actions.openWith(name, 'download') },
      ],
    };
  }

  private fileMenu(e: MouseEvent, active: NonNullable<ReturnType<TabManager['getActiveTab']>>, f: SFTPFileEntry): void {
    const items: MenuItem[] = [];
    if (!f.isDir) items.push(this.openWithItem(active, f.name));
    else items.push({ label: t('explorer.open'), icon: 'folder_open', onClick: () => void active.actions.navigate(active.state.currentPath.replace(/\/$/, '') + '/' + f.name) });
    items.push(
      { label: t('explorer.copy'), icon: 'content_copy', onClick: () => active.actions.copy() },
      { label: t('explorer.move'), icon: 'content_cut', onClick: () => active.actions.cut() },
      { label: t('explorer.rename'), icon: 'drive_file_rename_outline', onClick: async () => {
          const nn = await requestText({ title: t('explorer.rename'), message: t('explorer.renameMsg'), defaultValue: f.name });
          if (nn && nn !== f.name) void active.actions.rename(f.name, nn);
        } },
      { label: t('explorer.delete'), icon: 'delete', danger: true, onClick: async () => {
          if (await confirmAction({ title: t('explorer.delete'), message: t('explorer.deleteMsg') })) void active.actions.delete();
        } },
      { label: t('explorer.properties'), icon: 'settings', onClick: () => showChmodDialog(f, (mode) => void active.actions.chmod(f.name, mode)) },
    );
    showContextMenu(e.clientX, e.clientY, items);
  }

  private blankMenu(e: MouseEvent, active: NonNullable<ReturnType<TabManager['getActiveTab']>>): void {
    const items: MenuItem[] = [
      { label: t('explorer.upload'), icon: 'upload_file', onClick: () => this.pickAndUpload(active) },
      { label: t('explorer.newFolder'), icon: 'create_new_folder', onClick: async () => {
          const nm = await requestText({ title: t('explorer.newFolder'), message: t('explorer.newFolderMsg') });
          if (nm) void active.actions.mkdir(nm);
        } },
      { label: t('explorer.paste'), icon: 'content_paste', disabled: !active.state.clipboard, onClick: () => void active.actions.paste() },
      { label: t('explorer.refresh'), icon: 'refresh', onClick: () => void active.actions.refresh() },
    ];
    showContextMenu(e.clientX, e.clientY, items);
  }

  private pickAndUpload(active: NonNullable<ReturnType<TabManager['getActiveTab']>>): void {
    const input = document.createElement('input');
    input.type = 'file'; input.multiple = true;
    input.addEventListener('change', () => { if (input.files?.length) void active.actions.upload(input.files); });
    input.click();
  }

  private showSearchResults(hits: { path: string; name: string; dir: string }[]): void {
    const list = this.root.querySelector('#ex-list') as HTMLElement;
    const active = this.tabs.getActiveTab(); if (!list || !active) return;
    list.innerHTML = `<div class="p-2 text-on-surface-variant border-b border-outline-variant">${t('explorer.searchResults')}（${hits.length}）</div>` +
      hits.map((h) => `<div class="ex-hit flex items-center gap-2 px-3 py-1 hover:bg-surface-variant cursor-pointer" data-dir="${escapeHtml(h.dir)}"><span class="material-symbols-outlined" style="font-size:15px;">description</span><span class="truncate">${escapeHtml(h.path)}</span></div>`).join('');
    list.querySelectorAll('.ex-hit').forEach((el) =>
      el.addEventListener('click', () => void active.actions.navigate((el as HTMLElement).dataset.dir!)));
  }

  private renderStatus(): void {
    const bar = this.root.querySelector('#ex-status') as HTMLElement;
    const active = this.tabs.getActiveTab();
    if (!bar) return;
    if (!active) { bar.innerHTML = ''; return; }
    const st = active.state;
    const sel = st.selected.size;
    bar.innerHTML = `<span>${st.visibleFiles().length} ${t('explorer.items')}${sel ? ` · ${t('explorer.selected')} ${sel}` : ''}</span><span>${st.loading ? t('explorer.loading') : (st.error ? `⚠ ${escapeHtml(st.error)}` : '●')}</span>`;
  }
}

/** chmod 属性对话框（桌面/移动共用） */
export function showChmodDialog(entry: SFTPFileEntry, onApply: (mode: number) => void): void {
  const perm = entry.permissionsRaw & 0o777;
  const bit = (mask: number) => (perm & mask) ? 'checked' : '';
  const dlg = document.createElement('dialog');
  dlg.className = 'p-4 rounded bg-surface text-on-surface border border-outline-variant text-xs';
  dlg.innerHTML = `
    <div class="font-bold mb-2">${t('explorer.properties')} — ${escapeHtml(entry.name)}</div>
    <div class="mb-1 text-on-surface-variant">${t('explorer.size')}: ${entry.sizeFormatted} · ${entry.permissions}</div>
    <table class="my-2"><tr><td></td><td>${t('explorer.read')}</td><td>${t('explorer.write')}</td><td>${t('explorer.exec')}</td></tr>
      <tr><td>${t('explorer.owner')}</td><td><input type="checkbox" data-m="256" ${bit(0o400)}></td><td><input type="checkbox" data-m="128" ${bit(0o200)}></td><td><input type="checkbox" data-m="64" ${bit(0o100)}></td></tr>
      <tr><td>${t('explorer.group')}</td><td><input type="checkbox" data-m="32" ${bit(0o040)}></td><td><input type="checkbox" data-m="16" ${bit(0o020)}></td><td><input type="checkbox" data-m="8" ${bit(0o010)}></td></tr>
      <tr><td>${t('explorer.other')}</td><td><input type="checkbox" data-m="4" ${bit(0o004)}></td><td><input type="checkbox" data-m="2" ${bit(0o002)}></td><td><input type="checkbox" data-m="1" ${bit(0o001)}></td></tr>
    </table>
    <div class="flex justify-end gap-2 mt-2"><button id="chmod-cancel" class="px-3 py-1 rounded hover:bg-surface-variant">${t('common.cancel')}</button><button id="chmod-ok" class="px-3 py-1 rounded bg-primary-container text-on-primary-container">${t('common.confirm')}</button></div>
  `;
  document.body.appendChild(dlg);
  dlg.showModal();
  dlg.querySelector('#chmod-cancel')?.addEventListener('click', () => { dlg.close(); dlg.remove(); });
  dlg.querySelector('#chmod-ok')?.addEventListener('click', () => {
    let mode = 0;
    dlg.querySelectorAll<HTMLInputElement>('input[type=checkbox]').forEach((c) => { if (c.checked) mode |= Number(c.dataset.m); });
    onApply(mode);
    dlg.close(); dlg.remove();
  });
}
```

- [ ] **步骤 4b：键盘快捷键、目录树收起、断线可见性（规格 §8.2/§8.3/§16）**

补充三处（DRY：删除/重命名逻辑抽为方法，供右键菜单与快捷键复用）。

先在类内新增抽取方法与键盘处理器：

```typescript
  private async confirmDelete(active: NonNullable<ReturnType<TabManager['getActiveTab']>>): Promise<void> {
    if (!active.state.selected.size) return;
    if (await confirmAction({ title: t('explorer.delete'), message: t('explorer.deleteMsg') })) void active.actions.delete();
  }
  private async renameSelected(active: NonNullable<ReturnType<TabManager['getActiveTab']>>): Promise<void> {
    const sel = active.state.getSelectedEntries();
    if (sel.length !== 1) return;
    const nn = await requestText({ title: t('explorer.rename'), message: t('explorer.renameMsg'), defaultValue: sel[0].name });
    if (nn && nn !== sel[0].name) void active.actions.rename(sel[0].name, nn);
  }
  private onKeydown = (e: KeyboardEvent): void => {
    const active = this.tabs.getActiveTab();
    if (!active) return;
    if ((e.target as HTMLElement).tagName === 'INPUT') return; // 搜索/对话框输入不拦截
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.key.toLowerCase() === 'c') { active.actions.copy(); e.preventDefault(); }
    else if (ctrl && e.key.toLowerCase() === 'x') { active.actions.cut(); e.preventDefault(); }
    else if (ctrl && e.key.toLowerCase() === 'v') { void active.actions.paste(); e.preventDefault(); }
    else if (e.key === 'Delete') { void this.confirmDelete(active); e.preventDefault(); }
    else if (e.key === 'F2') { void this.renameSelected(active); e.preventDefault(); }
  };
```

改动点：
1. **快捷键绑定**：`render()` 最外层容器 `<div class="flex flex-col h-full ...">` 加 `tabindex="0" id="ex-focus"`；`render()` 末尾 `(this.root.querySelector('#ex-focus') as HTMLElement)?.addEventListener('keydown', this.onKeydown)`；`bindRow` 的点击处理里加 `(this.root.querySelector('#ex-focus') as HTMLElement)?.focus()` 使容器获焦（多窗口隔离，只有聚焦的 explorer 响应快捷键）。
2. **右键菜单复用**：`fileMenu` 中 `rename` 的 onClick 改为 `() => void this.renameSelected(active)`，`delete` 的 onClick 改为 `() => void this.confirmDelete(active)`（消除与快捷键的重复逻辑）。
3. **目录树收起**：`renderToolbar` 的导航按钮组最前面加一个按钮
   `<button class="ex-nav p-1 rounded hover:bg-surface-variant" data-act="tree" title="${t('explorer.tree')}"><span class="material-symbols-outlined" style="font-size:16px;">dock_to_right</span></button>`；
   在导航按钮 handler 的 if 链里加 `else if (act === 'tree') { st.treeCollapsed = !st.treeCollapsed; this.render(); }`；
   `render()` 主结构里 `#ex-tree` 容器 class 追加 `${active?.state.treeCollapsed ? 'hidden' : ''}`（active 为 null 时不影响）。
4. **断线可见性**：`renderStatus` 的在线标记改为读取连接状态——
   `const conn = this.pool.get(active.serverId); const online = conn?.isReady() ?? false;`，
   右侧显示 `${st.loading ? t('explorer.loading') : (st.error ? '⚠ ' + escapeHtml(st.error) : (online ? '● ' + t('explorer.connected') : '○ ' + t('explorer.offline')))}`。
   （完整"断线横幅 + 一键重连"留待 SP3；Plan A 通过状态栏离线标记 + 关闭标签/窗口重连覆盖基本场景。）

对应新增 i18n 键（并入任务 16）：`explorer.tree`=`目录树`/`Tree`、`explorer.connected`=`已连接`/`Connected`、`explorer.offline`=`已断开`/`Offline`。

- [ ] **步骤 4c：更新 `dispose` 清理键盘监听**

`dispose()` 中，容器随 `this.root.innerHTML = ''` 移除时监听器自动释放；无需显式解绑（`onKeydown` 绑在每次 render 重建的 `#ex-focus` 上）。确认 `dispose` 已调用 `closeContextMenu()` 与 `activeStateOff?.()`。

- [ ] **步骤 5：对话框签名说明（已核对）**

`ui-feedback` 既有签名（`frontend/src/ui-feedback.ts`）：
- `confirmAction({ message: string, title?, confirmText?, cancelText?, variant? }): Promise<boolean>`
- `requestText({ message: string, title?, defaultValue?, placeholder?, required?, validate? }): Promise<string | null>`

上方代码已按此签名调用（重命名用 `defaultValue: f.name`，删除确认用 `message`）。

- [ ] **步骤 6：编译校验**

运行：`npx tsc --noEmit -p tsconfig.json`
预期：无类型错误（i18n 键在任务 16 补齐前，`t()` 返回键名不影响编译）。

- [ ] **步骤 7：Commit**

```bash
git add frontend/src/explorer/desktop-explorer.ts
git commit -m "feat(explorer): 桌面布局 DesktopExplorer + chmod 对话框"
```

> 手动验证在任务 14（App 装配）后统一进行。

---
### 任务 13：`explorer/mobile-explorer.ts`

移动单面板：路径栏 + `[≡]` 全局菜单 + 每行竖三点 `⋮` 文件菜单。一个窗口一个标签（无标签栏）。长按行 = 多选切换，选中时顶部浮批量栏。复用 `context-menu`、`showChmodDialog`、`openWith`。

**文件：**
- 创建：`frontend/src/explorer/mobile-explorer.ts`

- [ ] **步骤 1：编写实现**

创建 `frontend/src/explorer/mobile-explorer.ts`：

```typescript
// 移动端资源管理器 —— 单面板 + 竖三点菜单 + 全局菜单

import type { TabManager } from './tab-manager';
import type { ConnectionPool } from './connection-pool';
import type { SFTPFileEntry } from './sftp-connection';
import { showContextMenu, type MenuItem } from './context-menu';
import { showChmodDialog } from './desktop-explorer';
import { t } from '../i18n';
import { requestText, confirmAction } from '../ui-feedback';

export interface MobileUICtx {
  onSwitchServer: () => void;   // 切换/新增服务器连接（弹选择页）
  onNewWindow: () => void;      // 新开资源管理器窗口
  onDisconnect: () => void;     // 断开当前服务器
}

function escapeHtml(s: string): string {
  const d = document.createElement('div'); d.textContent = s; return d.innerHTML;
}

export class MobileExplorer {
  private offCbs: (() => void)[] = [];
  private activeStateOff: (() => void) | null = null;
  private longPressTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private root: HTMLElement,
    private tabs: TabManager,
    private pool: ConnectionPool,
    private ui: MobileUICtx,
  ) {
    this.offCbs.push(this.tabs.onChange(() => this.render()));
  }

  render(): void {
    const active = this.tabs.getActiveTab();
    if (!active) { this.root.innerHTML = `<div class="p-6 text-on-surface-variant text-xs">${t('explorer.noTab')}</div>`; return; }
    const st = active.state;
    const sel = st.selected.size;
    this.root.innerHTML = `
      <div class="flex flex-col h-full bg-surface text-on-surface text-sm">
        <div class="flex items-center gap-2 px-3 h-11 border-b border-outline-variant shrink-0">
          <span class="material-symbols-outlined" style="font-size:18px;">folder</span>
          <span class="flex-1 truncate text-xs">${escapeHtml(st.currentPath)}</span>
          <button id="m-menu" class="p-1"><span class="material-symbols-outlined">menu</span></button>
        </div>
        ${sel > 0 ? `<div class="flex items-center gap-3 px-3 h-10 border-b border-outline-variant bg-elevated shrink-0 text-xs">
          <span class="flex-1">${t('explorer.selected')} ${sel}</span>
          <button id="m-copy" class="p-1"><span class="material-symbols-outlined" style="font-size:18px;">content_copy</span></button>
          <button id="m-cut" class="p-1"><span class="material-symbols-outlined" style="font-size:18px;">content_cut</span></button>
          <button id="m-del" class="p-1 text-error"><span class="material-symbols-outlined" style="font-size:18px;">delete</span></button>
          <button id="m-clear" class="p-1"><span class="material-symbols-outlined" style="font-size:18px;">close</span></button>
        </div>` : ''}
        <div id="m-list" class="flex-1 overflow-auto"></div>
      </div>
    `;
    const list = this.root.querySelector('#m-list') as HTMLElement;
    list.innerHTML = st.visibleFiles().map((f) => this.renderRow(f, st.selected.has(f.name))).join('')
      || `<div class="p-6 text-on-surface-variant">${t('explorer.empty')}</div>`;
    list.querySelectorAll('.m-row').forEach((el) => this.bindRow(el as HTMLElement, active));

    this.root.querySelector('#m-menu')?.addEventListener('click', (e) => this.globalMenu(e as MouseEvent, active));
    this.root.querySelector('#m-copy')?.addEventListener('click', () => { active.actions.copy(); active.state.clearSelection(); });
    this.root.querySelector('#m-cut')?.addEventListener('click', () => { active.actions.cut(); active.state.clearSelection(); });
    this.root.querySelector('#m-del')?.addEventListener('click', async () => {
      if (await confirmAction({ title: t('explorer.delete'), message: t('explorer.deleteMsg') })) void active.actions.delete();
    });
    this.root.querySelector('#m-clear')?.addEventListener('click', () => active.state.clearSelection());

    this.activeStateOff?.();
    this.activeStateOff = active.state.onChange(() => this.render());
  }

  private renderRow(f: SFTPFileEntry, selected: boolean): string {
    const icon = f.isDir ? 'folder' : (f.isLink ? 'link' : 'description');
    return `<div class="m-row flex items-center gap-3 px-3 py-2.5 border-b border-outline-variant/50 ${selected ? 'bg-primary-container/20' : ''}" data-name="${escapeHtml(f.name)}">
      <span class="material-symbols-outlined" style="font-size:20px;">${icon}</span>
      <div class="flex-1 min-w-0"><div class="truncate">${escapeHtml(f.name)}</div>${f.isDir ? '' : `<div class="text-[11px] text-on-surface-variant">${f.sizeFormatted}</div>`}</div>
      ${f.isDir ? '<span class="material-symbols-outlined text-on-surface-variant" style="font-size:18px;">chevron_right</span>' : ''}
      <button class="m-dots p-1" data-name="${escapeHtml(f.name)}"><span class="material-symbols-outlined" style="font-size:18px;">more_vert</span></button>
    </div>`;
  }

  private bindRow(el: HTMLElement, active: NonNullable<ReturnType<TabManager['getActiveTab']>>): void {
    const name = el.dataset.name!;
    const entry = () => active.state.files.find((f) => f.name === name)!;
    const st = active.state;
    // 长按 = 多选切换
    const startLP = () => { this.longPressTimer = setTimeout(() => { st.select(name, 'toggle'); this.longPressTimer = null; }, 500); };
    const cancelLP = () => { if (this.longPressTimer) { clearTimeout(this.longPressTimer); this.longPressTimer = null; } };
    el.addEventListener('touchstart', startLP, { passive: true });
    el.addEventListener('touchend', cancelLP);
    el.addEventListener('touchmove', cancelLP, { passive: true });
    // 点击
    el.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.m-dots')) return;
      const f = entry();
      if (st.selected.size > 0) { st.select(name, 'toggle'); return; } // 多选态下点击=切换
      if (f.isDir) void active.actions.navigate(st.currentPath.replace(/\/$/, '') + '/' + f.name);
      else this.fileMenu(e as MouseEvent, active, f);
    });
    // 竖三点
    el.querySelector('.m-dots')?.addEventListener('click', (e) => { e.stopPropagation(); this.fileMenu(e as MouseEvent, active, entry()); });
  }

  private openWithItem(active: NonNullable<ReturnType<TabManager['getActiveTab']>>, name: string): MenuItem {
    return {
      label: t('explorer.openWith'), icon: 'open_in_new', submenu: [
        { label: 'nano', icon: 'edit', onClick: () => void active.actions.openWith(name, 'nano') },
        { label: 'vim', icon: 'edit', onClick: () => void active.actions.openWith(name, 'vim') },
        { label: t('explorer.download'), icon: 'download', onClick: () => void active.actions.openWith(name, 'download') },
      ],
    };
  }

  private fileMenu(e: MouseEvent, active: NonNullable<ReturnType<TabManager['getActiveTab']>>, f: SFTPFileEntry): void {
    if (!active.state.selected.has(f.name)) active.state.select(f.name, 'single');
    const items: MenuItem[] = [];
    if (!f.isDir) items.push(this.openWithItem(active, f.name));
    items.push(
      { label: t('explorer.copy'), icon: 'content_copy', onClick: () => active.actions.copy() },
      { label: t('explorer.move'), icon: 'content_cut', onClick: () => active.actions.cut() },
      { label: t('explorer.rename'), icon: 'drive_file_rename_outline', onClick: async () => {
          const nn = await requestText({ title: t('explorer.rename'), message: t('explorer.renameMsg'), defaultValue: f.name });
          if (nn && nn !== f.name) void active.actions.rename(f.name, nn);
        } },
      { label: t('explorer.delete'), icon: 'delete', danger: true, onClick: async () => {
          if (await confirmAction({ title: t('explorer.delete'), message: t('explorer.deleteMsg') })) void active.actions.delete();
        } },
      { label: t('explorer.properties'), icon: 'settings', onClick: () => showChmodDialog(f, (mode) => void active.actions.chmod(f.name, mode)) },
    );
    showContextMenu(e.clientX, e.clientY, items);
  }

  private globalMenu(e: MouseEvent, active: NonNullable<ReturnType<TabManager['getActiveTab']>>): void {
    const items: MenuItem[] = [
      { label: t('explorer.upload'), icon: 'upload_file', onClick: () => this.pickAndUpload(active) },
      { label: t('explorer.newFolder'), icon: 'create_new_folder', onClick: async () => {
          const nm = await requestText({ title: t('explorer.newFolder'), message: t('explorer.newFolderMsg') });
          if (nm) void active.actions.mkdir(nm);
        } },
      { label: t('explorer.search'), icon: 'search', onClick: async () => {
          const q = await requestText({ title: t('explorer.search'), message: t('explorer.searchMsg') });
          if (q) { const hits = await active.actions.search(q); this.showSearchResults(hits); }
        } },
      { label: t('explorer.paste'), icon: 'content_paste', disabled: !active.state.clipboard, onClick: () => void active.actions.paste() },
      { label: t('explorer.refresh'), icon: 'refresh', onClick: () => void active.actions.refresh() },
      { label: t('explorer.newWindow'), icon: 'open_in_new', onClick: () => this.ui.onNewWindow() },
      { label: t('explorer.switchServer'), icon: 'dns', onClick: () => this.ui.onSwitchServer() },
      { label: t('explorer.disconnect'), icon: 'link_off', danger: true, onClick: () => this.ui.onDisconnect() },
    ];
    showContextMenu(e.clientX, e.clientY, items);
  }

  private pickAndUpload(active: NonNullable<ReturnType<TabManager['getActiveTab']>>): void {
    const input = document.createElement('input');
    input.type = 'file'; input.multiple = true;
    input.addEventListener('change', () => { if (input.files?.length) void active.actions.upload(input.files); });
    input.click();
  }

  private showSearchResults(hits: { path: string; name: string; dir: string }[]): void {
    const list = this.root.querySelector('#m-list') as HTMLElement;
    const active = this.tabs.getActiveTab(); if (!list || !active) return;
    list.innerHTML = hits.map((h) => `<div class="m-hit flex items-center gap-2 px-3 py-2 border-b border-outline-variant/50" data-dir="${escapeHtml(h.dir)}"><span class="material-symbols-outlined" style="font-size:18px;">description</span><span class="truncate text-xs">${escapeHtml(h.path)}</span></div>`).join('');
    list.querySelectorAll('.m-hit').forEach((el) => el.addEventListener('click', () => void active.actions.navigate((el as HTMLElement).dataset.dir!)));
  }

  /** 外壳返回键：返回上一级目录；已在根目录返回 false（关闭窗口） */
  onBack(): boolean {
    const active = this.tabs.getActiveTab();
    if (!active) return false;
    if (active.state.selected.size > 0) { active.state.clearSelection(); return true; }
    const p = active.state.currentPath;
    if (p === '/' || p === '.') return false;
    const parent = p.replace(/\/[^/]+\/?$/, '') || '/';
    void active.actions.navigate(parent);
    return true;
  }

  dispose(): void {
    this.activeStateOff?.();
    this.offCbs.forEach((f) => f());
    this.root.innerHTML = '';
  }
}
```

- [ ] **步骤 2：编译校验 + Commit**

运行：`npx tsc --noEmit -p tsconfig.json`
预期：无类型错误。

```bash
git add frontend/src/explorer/mobile-explorer.ts
git commit -m "feat(explorer): 移动端布局 MobileExplorer"
```

---
## Part 7 — 集成与迁移

### 任务 14：`terminal-app.ts` 加 `initialCommand` 并移除 SFTPPanel

`createTerminalWindow` 新增 `initialCommand`（会话就绪后注入 `<cmd>\n`，供 nano/vim 编辑）；移除全部 SFTPPanel 相关代码。编辑窗口不参与 host:port 去重（每次新开）。

**文件：**
- 修改：`frontend/src/apps/terminal-app.ts`（整体重写）

- [ ] **步骤 1：确认输入注入方法**

`SSHTerminal.sendWebSocketMessage(data: string)`（`frontend/src/terminal.ts:286`）把字符串作为终端输入发往服务器。`initialCommand` 用它注入：`terminal.sendWebSocketMessage(cmd + '\n')`。

- [ ] **步骤 2：整体重写 `terminal-app.ts`**

用以下内容替换 `frontend/src/apps/terminal-app.ts` 全文（移除 `SFTPPanel` import/变量/toggle 按钮/onBack 面板逻辑/onClose dispose；新增 `initialCommand`）：

```typescript
import { WindowManager, WindowHandle } from '../wm/window-manager';
import { SSHTerminal } from '../terminal';
import { notify } from '../ui-feedback';
import type { ShellContext } from '../shell/types';
import { createSoftKeyBar } from '../mobile/soft-key-bar';

let seq = 0;

/** 校验 wsUrl 为同源 ws/wss，防止连接到不受信任地址 */
function validateWsUrl(wsUrl: string): boolean {
  try {
    const url = new URL(wsUrl);
    if (url.protocol !== 'wss:' && url.protocol !== 'ws:') return false;
    return url.origin === window.location.origin ||
           url.origin === window.location.origin.replace(/^http/, 'ws');
  } catch {
    return false;
  }
}

export interface CreateTerminalWindowOptions {
  name: string;
  hostInfo?: { host: string; port: number };
  initialCommand?: string; // 会话就绪后自动执行（资源管理器"打开方式"nano/vim）
}

/** 已打开的终端窗口（按 host:port 去重；编辑窗口不参与去重） */
const openTerminals = new Map<string, WindowHandle>();

function hostKey(hostInfo?: { host: string; port: number }): string | null {
  return hostInfo ? `${hostInfo.host}:${hostInfo.port}` : null;
}

/**
 * 在桌面上打开一个终端窗口，装配 SSHTerminal，返回句柄。
 * 不负责建立连接——由调用者决定 connect(config)（匿名）或 connectWithWebSocket(ws)（服务器列表）。
 */
export function createTerminalWindow(
  wm: WindowManager,
  opts: CreateTerminalWindowOptions,
  ctx?: ShellContext,
): { terminal: SSHTerminal; win: WindowHandle } {
  const win = wm.openWindow({
    title: opts.name, icon: 'terminal',
    width: 760, height: 480, minWidth: 360, minHeight: 220,
  });

  // 去重 Map（编辑窗口跳过，避免多个 nano 窗口互相覆盖）
  const key = hostKey(opts.hostInfo);
  const dedup = key && !opts.initialCommand;
  if (dedup) openTerminals.set(key!, win);

  const containerId = `term-host-${++seq}`;
  const mountEl = document.createElement('div');
  mountEl.id = containerId;
  mountEl.style.cssText = 'position:absolute;inset:0;';
  win.bodyEl.appendChild(mountEl);

  const terminal = new SSHTerminal(containerId);

  terminal.setSessionReadyHandler(() => {
    win.setDisconnected(false);
    if (opts.initialCommand) {
      // 稍延迟确保 shell 提示符就绪
      setTimeout(() => terminal.sendWebSocketMessage(opts.initialCommand + '\n'), 300);
    }
  });
  terminal.setSessionClosedHandler(() => {
    win.setDisconnected(true);
  });

  win.onResize(() => terminal.fit());

  // 软键盘辅助条：仅移动模式挂载
  let keyBar: { el: HTMLElement; dispose: () => void } | null = null;
  const mountKeyBar = () => {
    if (keyBar) return;
    keyBar = createSoftKeyBar(terminal);
    win.bodyEl.appendChild(keyBar.el);
    const barH = keyBar.el.offsetHeight || 38;
    mountEl.style.bottom = `${barH}px`;
    terminal.fit();
  };
  const unmountKeyBar = () => {
    keyBar?.dispose(); keyBar = null;
    mountEl.style.bottom = '0';
    terminal.fit();
  };
  const syncKeyBar = (mode: 'desktop' | 'mobile') => (mode === 'mobile' ? mountKeyBar() : unmountKeyBar());
  let offMode: (() => void) | null = null;
  if (ctx) { syncKeyBar(ctx.getMode()); offMode = ctx.onModeChange(syncKeyBar); }

  win.onClose(() => {
    offMode?.();
    keyBar?.dispose();
    terminal.disconnect();
    terminal.dispose();
    if (dedup) openTerminals.delete(key!);
  });

  terminal.mount();
  return { terminal, win };
}

/** 服务器列表路径：用后端返回的 wsUrl（含 one-time-token）开终端窗口并连接 */
export function openTerminalFromWsUrl(
  wm: WindowManager,
  opts: { wsUrl: string; name: string; hostInfo?: { host: string; port: number }; initialCommand?: string },
  ctx?: ShellContext,
): void {
  if (!validateWsUrl(opts.wsUrl)) {
    notify('服务器返回了无效或不受信任的 WebSocket 地址。', { title: '无法建立连接', variant: 'danger' });
    return;
  }

  // 非编辑窗口才去重：同服务器已有终端 → 置顶
  const key = hostKey(opts.hostInfo);
  if (key && !opts.initialCommand) {
    const existing = openTerminals.get(key);
    if (existing) { existing.focus(); return; }
  }

  const { terminal } = createTerminalWindow(
    wm, { name: opts.name, hostInfo: opts.hostInfo, initialCommand: opts.initialCommand }, ctx,
  );
  const ws = new WebSocket(opts.wsUrl);
  ws.binaryType = 'arraybuffer';
  terminal.connectWithWebSocket(ws, opts.hostInfo);
}
```

- [ ] **步骤 3：编译校验**

运行：`npx tsc --noEmit -p tsconfig.json`
预期：无类型错误。此时 `sftp-panel.ts` 仍存在但已无引用（任务 17 删除文件）。

- [ ] **步骤 4：跑现有测试确保未破坏**

运行：`npm test`
预期：全部 PASS（含 `tests/build/*`，确认无残留 SFTP 面板引用导致的构建断言失败）。

- [ ] **步骤 5：Commit**

```bash
git add frontend/src/apps/terminal-app.ts
git commit -m "feat(terminal): createTerminalWindow 支持 initialCommand，移除 SFTPPanel 装配"
```

---

### 任务 15：`apps/explorer-app.ts`

装配连接池 / 标签 / 桌面·移动 UI，实现连接流程、模式切换、打开方式（复用终端窗口）、标签拖出。

**文件：**
- 创建：`frontend/src/apps/explorer-app.ts`

- [ ] **步骤 1：编写实现**

创建 `frontend/src/apps/explorer-app.ts`：

```typescript
// 资源管理器 App 入口 —— 装配连接池/标签/UI

import type { WindowManager } from '../wm/window-manager';
import type { ShellContext } from '../shell/types';
import { ConnectionPool } from '../explorer/connection-pool';
import { TabManager } from '../explorer/tab-manager';
import { DesktopExplorer, type ExplorerUICtx } from '../explorer/desktop-explorer';
import { MobileExplorer, type MobileUICtx } from '../explorer/mobile-explorer';
import { renderServerPicker } from '../explorer/server-picker';
import type { ActionsContext } from '../explorer/explorer-actions';
import { fetchSavedServers, connectServerWs, type SavedServer } from '../shared/server-data';
import { openTerminalFromWsUrl } from './terminal-app';
import { notify } from '../ui-feedback';
import { t } from '../i18n';

export function openExplorerWindow(
  wm: WindowManager,
  ctx?: ShellContext,
  initialServer?: SavedServer,
): void {
  const win = wm.openWindow({
    title: t('explorer.title'), icon: 'folder',
    width: 900, height: 560, minWidth: 420, minHeight: 320,
  });

  const pool = new ConnectionPool();
  let allServers: SavedServer[] = [];

  const actionsCtx: ActionsContext = {
    openInTerminal: (server, command) => {
      void (async () => {
        try {
          const wsUrl = await connectServerWs(server.id);
          openTerminalFromWsUrl(
            wm,
            { wsUrl, name: `${server.name}: ${command}`, hostInfo: { host: server.host, port: server.port }, initialCommand: command },
            ctx,
          );
        } catch (e) {
          notify(e instanceof Error ? e.message : String(e), { variant: 'danger' });
        }
      })();
    },
    notify: (message, variant) => notify(message, { variant: variant ?? 'info' }),
  };

  const tabs = new TabManager(pool, actionsCtx);

  const uiHost = document.createElement('div');
  uiHost.style.cssText = 'position:absolute;inset:0;';
  win.bodyEl.appendChild(uiHost);

  let desktop: DesktopExplorer | null = null;
  let mobile: MobileExplorer | null = null;

  const connectAndTab = async (server: SavedServer): Promise<void> => {
    try {
      await tabs.createTab(server);
      mountUI();
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), { title: t('explorer.connectFailed'), variant: 'danger' });
      showPicker();
    }
  };

  const showPicker = (): void => {
    const layer = document.createElement('div');
    layer.style.cssText = 'position:absolute;inset:0;z-index:20;background:var(--surface,#0d0d0d);overflow:auto;';
    uiHost.appendChild(layer);
    void renderServerPicker({
      container: layer,
      connectedIds: new Set(pool.getAll().map((p) => p.server.id)),
      onPick: async (server) => { layer.remove(); await connectAndTab(server); },
      onError: (m) => notify(m, { variant: 'danger' }),
    });
  };

  const uiCtx: ExplorerUICtx = {
    allServers: () => allServers,
    onNewTab: () => showPicker(),
    onConnectServer: (server) => void connectAndTab(server),
    onDetachTab: (tabId) => {
      const tab = tabs.getAllTabs().find((tt) => tt.id === tabId);
      if (!tab) return;
      const server = pool.getServer(tab.serverId);
      if (!server) return;
      tabs.closeTab(tabId);
      // Plan A：拖出 = 新窗口重连同服务器（完整状态迁移留待 SP3）
      openExplorerWindow(wm, ctx, server);
    },
    onDisconnectServer: (sid) => pool.disconnect(sid),
  };

  const mobileCtx: MobileUICtx = {
    onSwitchServer: () => showPicker(),
    onNewWindow: () => openExplorerWindow(wm, ctx),
    onDisconnect: () => { const a = tabs.getActiveTab(); if (a) pool.disconnect(a.serverId); },
  };

  function mountUI(): void {
    const mode = ctx?.getMode() ?? 'desktop';
    desktop?.dispose(); mobile?.dispose();
    desktop = null; mobile = null;
    if (mode === 'mobile') { mobile = new MobileExplorer(uiHost, tabs, pool, mobileCtx); mobile.render(); }
    else { desktop = new DesktopExplorer(uiHost, tabs, pool, uiCtx); desktop.render(); }
  }

  const offMode = ctx?.onModeChange(() => { if (tabs.count() > 0) mountUI(); });
  win.onBack(() => (mobile ? mobile.onBack() : false));
  win.onClose(() => {
    offMode?.();
    desktop?.dispose(); mobile?.dispose();
    tabs.dispose();
    pool.disposeAll();
  });

  // 初始：加载服务器列表 → 有初始服务器直接连，否则展示选择页
  void (async () => {
    try { allServers = await fetchSavedServers(); } catch { /* 忽略，选择页会再拉一次 */ }
    if (initialServer) await connectAndTab(initialServer);
    else showPicker();
  })();
}
```

- [ ] **步骤 2：编译校验**

运行：`npx tsc --noEmit -p tsconfig.json`
预期：无类型错误。

- [ ] **步骤 3：Commit**

```bash
git add frontend/src/apps/explorer-app.ts
git commit -m "feat(explorer): explorer-app 装配连接池/标签/UI 与打开方式"
```

---
### 任务 16：`main.ts` 注册 + 新增 i18n 键

注册资源管理器 App，新增全部 `explorer.*` 文案（`sftp.*` 的移除放到任务 17，与删文件原子完成）。

**文件：**
- 修改：`frontend/src/main.ts`
- 修改：`frontend/src/i18n/locales/zh-CN.ts`
- 修改：`frontend/src/i18n/locales/en-US.ts`

- [ ] **步骤 1：main.ts 注册 explorer App**

`frontend/src/main.ts` 顶部 import 补充：

```typescript
import { openExplorerWindow } from './apps/explorer-app';
```

`showDesktop` 的 `registerApps` 调整为（在 servers 与 settings 之间插入 explorer）：

```typescript
  d.registerApps([
    { id: 'servers', title: t('server.list'), icon: 'dns', open: () => openServersWindow(d.wm, user, onLogout, d) },
    { id: 'explorer', title: t('explorer.title'), icon: 'folder', open: () => openExplorerWindow(d.wm, d) },
    { id: 'settings', title: '设置', icon: 'settings', open: () => openSettingsWindow(d.wm, d, user, onLogout) },
  ]);
```

- [ ] **步骤 2：zh-CN.ts 新增 explorer.* 键**

在 `frontend/src/i18n/locales/zh-CN.ts` 的 `sftp.*` 键块之后插入：

```typescript
  'explorer.title': '资源管理器',
  'explorer.connect': '选择服务器',
  'explorer.noServers': '暂无已保存的服务器',
  'explorer.connectFailed': '连接失败',
  'explorer.newTab': '新建标签页',
  'explorer.newWindow': '新窗口',
  'explorer.back': '后退',
  'explorer.up': '上级目录',
  'explorer.search': '搜索文件…',
  'explorer.searchMsg': '输入搜索关键词（远程 find）。',
  'explorer.searchResults': '搜索结果',
  'explorer.name': '名称',
  'explorer.size': '大小',
  'explorer.perms': '权限',
  'explorer.modified': '修改时间',
  'explorer.empty': '此目录为空',
  'explorer.noTab': '未打开标签页',
  'explorer.items': '个项目',
  'explorer.selected': '已选中',
  'explorer.loading': '加载中…',
  'explorer.open': '打开',
  'explorer.openWith': '打开方式',
  'explorer.download': '下载',
  'explorer.copy': '复制',
  'explorer.move': '移动',
  'explorer.rename': '重命名',
  'explorer.renameMsg': '输入新名称。',
  'explorer.delete': '删除',
  'explorer.deleteMsg': '确定删除选中项吗？此操作无法撤销。',
  'explorer.properties': '属性',
  'explorer.upload': '上传文件',
  'explorer.newFolder': '新建文件夹',
  'explorer.newFolderMsg': '输入新文件夹名称。',
  'explorer.paste': '粘贴',
  'explorer.refresh': '刷新',
  'explorer.switchServer': '切换服务器',
  'explorer.disconnect': '断开连接',
  'explorer.read': '读',
  'explorer.write': '写',
  'explorer.exec': '执行',
  'explorer.owner': '所有者',
  'explorer.group': '组',
  'explorer.other': '其他',
  'explorer.tree': '目录树',
  'explorer.connected': '已连接',
  'explorer.offline': '已断开',
```

- [ ] **步骤 3：en-US.ts 新增对应键**

在 `frontend/src/i18n/locales/en-US.ts` 对象中插入相同键名的英文值（保持与 zh-CN 键一一对应，否则 `Record<keyof typeof zhCN>` 类型不通过）：

```typescript
  'explorer.title': 'File Explorer',
  'explorer.connect': 'Select Server',
  'explorer.noServers': 'No saved servers',
  'explorer.connectFailed': 'Connection failed',
  'explorer.newTab': 'New Tab',
  'explorer.newWindow': 'New Window',
  'explorer.back': 'Back',
  'explorer.up': 'Parent',
  'explorer.search': 'Search files…',
  'explorer.searchMsg': 'Enter search keyword (remote find).',
  'explorer.searchResults': 'Search results',
  'explorer.name': 'Name',
  'explorer.size': 'Size',
  'explorer.perms': 'Perms',
  'explorer.modified': 'Modified',
  'explorer.empty': 'This folder is empty',
  'explorer.noTab': 'No tab open',
  'explorer.items': 'items',
  'explorer.selected': 'Selected',
  'explorer.loading': 'Loading…',
  'explorer.open': 'Open',
  'explorer.openWith': 'Open with',
  'explorer.download': 'Download',
  'explorer.copy': 'Copy',
  'explorer.move': 'Move',
  'explorer.rename': 'Rename',
  'explorer.renameMsg': 'Enter new name.',
  'explorer.delete': 'Delete',
  'explorer.deleteMsg': 'Delete selected items? This cannot be undone.',
  'explorer.properties': 'Properties',
  'explorer.upload': 'Upload',
  'explorer.newFolder': 'New Folder',
  'explorer.newFolderMsg': 'Enter new folder name.',
  'explorer.paste': 'Paste',
  'explorer.refresh': 'Refresh',
  'explorer.switchServer': 'Switch Server',
  'explorer.disconnect': 'Disconnect',
  'explorer.read': 'R',
  'explorer.write': 'W',
  'explorer.exec': 'X',
  'explorer.owner': 'Owner',
  'explorer.group': 'Group',
  'explorer.other': 'Other',
  'explorer.tree': 'Tree',
  'explorer.connected': 'Connected',
  'explorer.offline': 'Offline',
```

- [ ] **步骤 4：确认 chmod 对话框依赖的 common 键已存在**

`showChmodDialog` 用 `common.confirm` / `common.cancel`。已确认二者存在于 `zh-CN.ts`（`'common.confirm': '确定'`、`'common.cancel': '取消'`），无需新增。

- [ ] **步骤 5：构建校验**

运行：`npm run build:frontend`
预期：构建成功，`i18n.test.ts`（若跑）确认 zh/en 键集一致。

运行：`npx vitest run tests/i18n.test.ts`
预期：PASS（zh 与 en 键一一对应）。

- [ ] **步骤 6：Commit**

```bash
git add frontend/src/main.ts frontend/src/i18n/locales/zh-CN.ts frontend/src/i18n/locales/en-US.ts
git commit -m "feat(explorer): 注册资源管理器 App + explorer i18n 文案"
```

---

### 任务 17：删除旧 SFTP 面板 + 收尾

删除被替代的 `sftp-panel.ts`；连带删除依赖它的孤立死代码 `frontend/src/tab-manager.ts`（SP1 桌面外壳起已无任何 import，被 `WindowManager` 取代，且 import 了将被删的 `sftp-panel`）；移除 `sftp.*` i18n 键。

**文件：**
- 删除：`frontend/src/sftp-panel.ts`
- 删除：`frontend/src/tab-manager.ts`（孤立死代码，依赖被删文件）
- 修改：`frontend/src/i18n/locales/zh-CN.ts`（移除 `sftp.*`）
- 修改：`frontend/src/i18n/locales/en-US.ts`（移除 `sftp.*`）

> 说明：`grep` 已确认 `frontend/src/tab-manager.ts` 无任何引用（既非静态 import 也非动态 import）。它与新建的 `frontend/src/explorer/tab-manager.ts` 同名但不同路径、职责不同（前者是旧终端多标签，后者是资源管理器标签）。`src/worker/html.ts` 中的 `sftp` 是内联 HTML 字符串（非 TS import），不受影响、无需改动。

- [ ] **步骤 1：删除文件**

```bash
git rm frontend/src/sftp-panel.ts frontend/src/tab-manager.ts
```

- [ ] **步骤 2：移除 `sftp.*` i18n 键**

从 `frontend/src/i18n/locales/zh-CN.ts` 与 `frontend/src/i18n/locales/en-US.ts` 中删除全部 `sftp.*` 键（zh-CN 约在 167-200 行的 34 个键；en-US 对应键）。两文件必须同步删除，保持键集一致。

- [ ] **步骤 3：确认无残留引用**

运行：`grep -rn "SFTPPanel\|sftp-panel\|'\./tab-manager'\|from '../tab-manager'" frontend/src`
预期：无结果（`terminal-app.ts` 已在任务 14 移除引用）。

运行：`grep -rn "sftp\." frontend/src/i18n`
预期：无结果（`sftp.*` 键已全部移除）。

- [ ] **步骤 4：类型与构建校验**

运行：`npx tsc --noEmit -p tsconfig.json`
预期：无类型错误（删除死代码 `tab-manager.ts` 后不再有对 `sftp-panel` 的悬空 import）。

运行：`npm run build:frontend`
预期：构建成功。

- [ ] **步骤 5：全量测试**

运行：`npm test`
预期：全部 PASS（含 `tests/build/no-native-dialogs.test.ts`、`tests/i18n.test.ts`）。

- [ ] **步骤 6：Commit**

```bash
git add -A
git commit -m "refactor(explorer): 移除旧 SFTP 面板与孤立终端标签管理器，清理 sftp i18n"
```

---

## 手动集成验证（全部任务完成后）

在真实服务器上运行 `npm run dev`，验证以下场景：

- [ ] 桌面模式：桌面图标/开始菜单出现"资源管理器"，点击打开 → 展示服务器选择页
- [ ] 选择服务器 → 建立连接 → 首个标签页加载 home 目录文件列表
- [ ] 双击文件夹进入；面包屑点击返回；← → ↑ 🏠 刷新按钮正常
- [ ] 单击/Ctrl 单击/Shift 单击多选；列头点击排序（文件夹恒在前）
- [ ] 右键文件 → 打开方式 → nano：新开终端窗口并自动进入 `nano <file>`
- [ ] 右键 → 复制，导航到别处 → 空白右键 → 粘贴（同服务器 `cp -r`）
- [ ] 剪切 → 粘贴（`rename` 移动）；删除（确认框）；重命名（F2 场景走右键）；新建文件夹
- [ ] 右键 → 属性 → 勾选权限 → 应用（chmod 生效，刷新后权限更新）
- [ ] 拖拽本地文件到列表 → 上传；选中文件 → 下载
- [ ] 搜索框输入即时过滤；回车远程 `find` → 结果列表 → 点击导航到所在目录
- [ ] `[+]` 新建标签连另一台服务器；左树同时展开两台服务器目录；标签拖出为独立窗口
- [ ] 切到移动模式（设置或窄屏）：单面板 + `[≡]` 全局菜单 + 竖三点文件菜单
- [ ] 移动端：点文件夹进入，点文件弹打开方式；长按多选 → 顶部批量栏；返回键逐级返回、根目录关窗
- [ ] 关闭资源管理器窗口 → 全部连接断开（隐藏终端清理，无残留 WS）
- [ ] 终端 App 仍正常：匿名连接、服务器列表连接、软键盘辅助条（SFTP 面板已移除，无 toggle 按钮）

---

## 规格覆盖矩阵（自检）

对照 `docs/superpowers/specs/2026-07-25-file-explorer-sp2-design.md` 逐节核对：

| 规格节 | 需求 | 对应任务 |
|--------|------|----------|
| §2.1 文件结构 | 全部新建文件 | 任务 4-15 |
| §3 SFTPConnection | Promise 化连接与操作 | 任务 5 |
| §3.2 ConnectionPool | 多连接 + 引用计数 | 任务 6 |
| §4 ExplorerState | 路径/文件/选中/剪贴板/历史/排序 | 任务 7 |
| §5 ExplorerActions | 导航/CRUD/复制移动/搜索/打开方式 | 任务 8 |
| §6 TabManager | 标签 CRUD/切换/拖出 | 任务 9 + 任务 15（拖出） |
| §7 跨服务器传输 | 三级策略 | **Plan B**（本计划 `paste` 同服务器实现，跨服务器提示占位） |
| §8 桌面 UI | 树/标签/列表/面包屑/工具栏/右键/快捷键 | 任务 12（含步骤 4b 快捷键与树收起） |
| §9 移动 UI | 单面板/竖三点/全局菜单/长按多选/返回键 | 任务 13 |
| §10 打开方式 | nano/vim/下载 + initialCommand | 任务 8 + 任务 12/13 + 任务 14 |
| §11 搜索/过滤 | 即时过滤 + 远程 find | 任务 8 + 任务 12/13 |
| §12 属性 chmod | 权限对话框 | 任务 12（showChmodDialog） |
| §13 后端 | chmod/readTextFile/exec | 任务 1/2/3 |
| §14 集成迁移 | 注册/共享数据/移除旧面板/跨 App | 任务 4/14/15/16/17 |
| §15 i18n | explorer.* 文案 | 任务 16 |
| §16 错误处理 | 连接失败/操作失败/断线 | 任务 15（失败返回选择页）+ 任务 12 步骤 4b（断线离线标记） |

### 已知简化项（Plan A 明确不做，留待 Plan B / SP3）

- **跨服务器传输**（§7、§13.2）：Plan B 全权负责。本计划 `ExplorerActions.paste()` 检测到跨服务器时 `notify('跨服务器传输将在后续版本支持')`，接口与剪贴板 `sourceServerId` 已预留。
- **断线横幅 + 一键重连**（§16）：Plan A 仅在状态栏显示 `○ 已断开` 离线标记；完整"横幅 + 自动重连"留 SP3。用户可关闭标签/窗口后重新连接。
- **标签完整状态迁移**（§6 拖出）：Plan A 拖出 = 新窗口重连同服务器（回到 home）；保留当前路径/选中的完整迁移留 SP3。
- **状态栏选中大小合计**（§8.1 示例中的 `(1.2 KB)`）：Plan A 状态栏显示项目数与选中数，大小合计留 SP3。
- **nano/vim 未安装检测**（§16）：依赖终端窗口内的报错回显，不做前置探测。

### 占位符扫描

通篇无 `TODO` / `待定` / 空代码块 / "类似任务 N" 引用；所有方法均有完整实现或明确的范围声明（跨服务器分支为声明式 `notify`，非占位）。

### 类型一致性

跨任务共享类型均单一来源：`SFTPFileEntry`（任务 5）、`SavedServer`（任务 4）、`ActionsContext`（任务 8）、`ExplorerUICtx`（任务 12）、`MobileUICtx`（任务 13）、`Tab`/`SortKey`（任务 9/7）。方法签名在定义处与调用处一致。

> **SavedServer 与规格 §14.2 的差异**：规格示例含 `wsUrl` 字段，本计划改为 `id` + 运行时 `connectServerWs(id)` 动态获取（wsUrl 含一次性 token，不应缓存）。这是更正确的实现，非遗漏。


