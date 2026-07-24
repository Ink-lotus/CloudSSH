// Cloudflare Turnstile 配置获取与控件控制器（迁移自 auth-form.ts）

export interface AuthConfig {
  turnstileEnabled: boolean;
  sitekey: string;
  githubAuthEnabled: boolean;
}

/** 拉取 /api/config；失败时全部视为未启用 */
export async function fetchAuthConfig(): Promise<AuthConfig> {
  try {
    const res = await fetch('/api/config');
    const c = (await res.json()) as Partial<AuthConfig>;
    return {
      turnstileEnabled: !!c.turnstileEnabled,
      sitekey: c.sitekey ?? '',
      githubAuthEnabled: !!c.githubAuthEnabled,
    };
  } catch {
    return { turnstileEnabled: false, sitekey: '', githubAuthEnabled: false };
  }
}

/** 管理单个 Turnstile 控件的渲染与验证状态 */
export class TurnstileController {
  private verified = false;
  private widgetId: string | null = null;

  constructor(private readonly enabled: boolean, private readonly sitekey: string) {}

  /** 是否需要用户完成验证 */
  get required(): boolean {
    return this.enabled && !!this.sitekey;
  }

  /** 未启用则恒为 true；启用则取决于是否已通过 */
  isVerified(): boolean {
    return !this.required || this.verified;
  }

  /** 渲染控件到容器；未启用或 SDK 未就绪则跳过 */
  render(container: HTMLElement): void {
    if (!this.required || !window.turnstile) return;
    this.widgetId = window.turnstile.render(container, {
      sitekey: this.sitekey,
      theme: 'dark',
      callback: async (token: string) => {
        try {
          const res = await fetch('/api/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token }),
          });
          const result = (await res.json()) as { success: boolean };
          this.verified = result.success === true;
        } catch {
          this.verified = false;
        }
      },
      'expired-callback': () => { this.verified = false; },
      'error-callback': () => { this.verified = false; },
    });
  }
}
