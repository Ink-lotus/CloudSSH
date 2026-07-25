// 通用弹出菜单 —— 右键(桌面)/竖三点(移动)，支持二级子菜单

export interface MenuItem {
  label: string;
  icon?: string;
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

  const rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth) menu.style.left = `${window.innerWidth - rect.width - 4}px`;
  if (rect.bottom > window.innerHeight) menu.style.top = `${window.innerHeight - rect.height - 4}px`;

  setTimeout(() => {
    document.addEventListener('click', onDocClick, true);
    document.addEventListener('keydown', onKeydown, true);
  }, 0);
}
