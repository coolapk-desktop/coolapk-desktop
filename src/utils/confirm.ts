import { reactive } from 'vue';

export interface ConfirmationOptions {
  title?: string;
  message: string;
  confirmText?: string;
  danger?: boolean;
}

export const confirmationState = reactive({
  isOpen: false,
  title: '请确认',
  message: '',
  confirmText: '确定',
  danger: false
});

/** 同时排队的确认请求上限，超出的请求直接判否，避免无人结算时无限堆积。 */
const MAX_PENDING = 8;

interface PendingConfirmation {
  options: Required<ConfirmationOptions>;
  resolve: (confirmed: boolean) => void;
}

const queue: PendingConfirmation[] = [];

function normalize(options: ConfirmationOptions | string): Required<ConfirmationOptions> {
  const normalized = typeof options === 'string' ? { message: options } : options;
  return {
    title: normalized.title || '请确认',
    message: normalized.message,
    confirmText: normalized.confirmText || '确定',
    danger: Boolean(normalized.danger)
  };
}

function present(request: PendingConfirmation) {
  confirmationState.title = request.options.title;
  confirmationState.message = request.options.message;
  confirmationState.confirmText = request.options.confirmText;
  confirmationState.danger = request.options.danger;
  confirmationState.isOpen = true;
}

/**
 * 请求一次应用内确认。
 *
 * 同时只显示一个确认框，后来的请求进入 FIFO 队列逐条弹出；不会像旧实现那样把
 * 仍在等待的请求直接判否（并发的两次写操作曾因此必丢一次）。
 */
export function requestConfirmation(options: ConfirmationOptions | string): Promise<boolean> {
  const normalized = normalize(options);
  return new Promise<boolean>((resolve) => {
    if (queue.length >= MAX_PENDING) {
      resolve(false);
      return;
    }
    const request: PendingConfirmation = { options: normalized, resolve };
    const isFirst = queue.length === 0;
    queue.push(request);
    if (isFirst) present(request);
  });
}

export function settleConfirmation(confirmed: boolean) {
  const current = queue.shift();
  current?.resolve(confirmed);
  const next = queue[0];
  if (next) present(next);
  else confirmationState.isOpen = false;
}
