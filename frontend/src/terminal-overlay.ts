/** 循环点动画的下一帧：'' → '.' → '..' → '...' → '' */
export function nextDots(prev: string): string {
  return prev.length >= 3 ? '' : `${prev}.`;
}

/**
 * 终端连接状态覆盖层：叠加在终端容器上显示连接进度。
 * 主状态行带循环点动画；详细进度逐行追加；就绪后淡出移除。
 */
export class ConnectionOverlay {
  private root: HTMLElement;
  private headText: HTMLElement;
  private dots: HTMLElement;
  private log: HTMLElement;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.style.cssText =
      'position:absolute;inset:0;z-index:5;display:flex;flex-direction:column;' +
      'align-items:center;justify-content:center;gap:8px;padding:16px;text-align:center;' +
      'background:rgba(8,8,8,.82);color:var(--text,#4af626);font-size:13px;line-height:1.7;' +
      'transition:opacity .3s ease;overflow:auto;';
    const head = document.createElement('div');
    head.style.cssText = 'font-weight:600;';
    this.headText = document.createElement('span');
    this.dots = document.createElement('span');
    head.append(this.headText, this.dots);
    this.log = document.createElement('div');
    this.log.style.cssText = 'opacity:.75;font-size:12px;max-width:90%;';
    this.root.append(head, this.log);
    parent.appendChild(this.root);
  }

  /** 设置主状态文字并启动循环点动画 */
  connecting(text: string): void {
    this.headText.textContent = text;
    this.root.style.color = 'var(--text,#4af626)';
    this.root.style.opacity = '1';
    this.startDots();
  }

  /** 追加一行详细进度 */
  append(line: string): void {
    const el = document.createElement('div');
    el.textContent = line;
    this.log.appendChild(el);
  }

  /** 显示错误（红色，停止动画，保留可见） */
  error(text: string): void {
    this.stopDots();
    this.dots.textContent = '';
    this.headText.textContent = text;
    this.root.style.color = 'var(--error,#ffb4ab)';
    this.root.style.opacity = '1';
  }

  /** 淡出并从 DOM 移除 */
  dismiss(): void {
    this.stopDots();
    this.root.style.opacity = '0';
    setTimeout(() => this.root.remove(), 320);
  }

  private startDots(): void {
    this.stopDots();
    this.dots.textContent = '';
    this.timer = setInterval(() => {
      this.dots.textContent = nextDots(this.dots.textContent ?? '');
    }, 400);
  }

  private stopDots(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }
}
