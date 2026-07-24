import type { SSHTerminal } from '../terminal';

// 控制序列映射
const SEQ: Record<string, string> = {
  Esc: '\x1b', Tab: '\t',
  Up: '\x1b[A', Down: '\x1b[B', Right: '\x1b[C', Left: '\x1b[D',
  Home: '\x1b[H', End: '\x1b[F', PgUp: '\x1b[5~', PgDn: '\x1b[6~',
};

const PRIMARY: Array<[string, string]> = [
  ['Esc', 'Esc'], ['Ctrl', 'Ctrl'], ['Alt', 'Alt'], ['Tab', 'Tab'],
  ['↑', 'Up'], ['↓', 'Down'], ['←', 'Left'], ['→', 'Right'],
];

const EXTRA: Array<[string, string]> = [
  ['|', '|'], ['~', '~'], ['/', '/'], ['-', '-'],
  ['PgUp', 'PgUp'], ['PgDn', 'PgDn'], ['Home', 'Home'], ['End', 'End'], ['^C', 'CtrlC'],
];

/** 终端软键盘辅助条：吸附终端底部，发送控制序列。返回 { el, dispose } */
export function createSoftKeyBar(terminal: SSHTerminal): { el: HTMLElement; dispose: () => void } {
  let ctrl = false, alt = false, expanded = false;

  const bar = document.createElement('div');
  bar.className = 'soft-key-bar';
  bar.style.cssText =
    'position:absolute;left:0;right:0;bottom:0;z-index:20;display:flex;gap:4px;overflow-x:auto;' +
    'padding:5px 4px;background:var(--bg-elevated,#0d1017);border-top:1px solid var(--border-strong,#2a2f3a);';

  const send = (data: string) => terminal.sendWebSocketMessage(data);

  const press = (code: string) => {
    // 粘滞修饰键
    if (code === 'Ctrl') { ctrl = !ctrl; render(); return; }
    if (code === 'Alt') { alt = !alt; render(); return; }
    if (code === 'CtrlC') { send('\x03'); return; }

    let base = SEQ[code];
    if (base === undefined) {
      // 字面字符（| ~ / - 等）
      base = code;
    }
    if (ctrl && base.length === 1) {
      const c = base.toUpperCase().charCodeAt(0);
      if (c >= 64 && c <= 95) base = String.fromCharCode(c - 64);
    }
    if (alt) base = '\x1b' + base;
    send(base);
    ctrl = false; alt = false; render();
  };

  const mkBtn = (label: string, code: string) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.dataset['code'] = code;
    b.style.cssText =
      'flex:0 0 auto;border:1px solid var(--border-strong,#2a2f3a);border-radius:6px;' +
      'padding:4px 9px;font-size:12px;background:transparent;min-width:36px;min-height:30px;';
    if (code !== '__toggle') b.addEventListener('click', () => press(code));
    return b;
  };

  const render = () => {
    bar.innerHTML = '';
    for (const [label, code] of PRIMARY) bar.appendChild(mkBtn(label, code));
    const more = mkBtn(expanded ? '×' : '…', '__toggle');
    more.addEventListener('click', (e) => { e.stopPropagation(); expanded = !expanded; render(); });
    bar.appendChild(more);
    if (expanded) for (const [label, code] of EXTRA) bar.appendChild(mkBtn(label, code));
    // 修饰键高亮
    bar.querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
      const on = (b.dataset['code'] === 'Ctrl' && ctrl) || (b.dataset['code'] === 'Alt' && alt);
      b.style.background = on ? 'var(--accent,#1b6a3a)' : 'transparent';
      b.style.color = on ? '#fff' : '';
    });
  };
  render();

  return { el: bar, dispose: () => bar.remove() };
}
