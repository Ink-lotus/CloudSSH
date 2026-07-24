// 上下文感知返回：按 LIFO 依次询问处理器，任一返回 true（已消费）即停。
export function dispatchBack(handlers: Array<() => boolean>): boolean {
  for (let i = handlers.length - 1; i >= 0; i--) {
    if (handlers[i]()) return true;
  }
  return false;
}
