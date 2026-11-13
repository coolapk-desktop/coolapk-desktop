import { beforeEach, describe, expect, it } from 'vitest';
import { confirmationState, requestConfirmation, settleConfirmation } from '../confirm';

/** 清空上一个用例可能残留的排队请求。 */
function drain() {
  while (confirmationState.isOpen) settleConfirmation(false);
}

describe('application confirmation service', () => {
  beforeEach(drain);

  it('resolves only after the application confirmation host settles it', async () => {
    const pending = requestConfirmation({
      title: '删除动态',
      message: '确定删除吗？',
      confirmText: '删除',
      danger: true
    });

    expect(confirmationState.isOpen).toBe(true);
    expect(confirmationState.title).toBe('删除动态');
    expect(confirmationState.danger).toBe(true);

    settleConfirmation(true);
    await expect(pending).resolves.toBe(true);
    expect(confirmationState.isOpen).toBe(false);
  });

  it('queues a new confirmation instead of rejecting the pending one', async () => {
    const first = requestConfirmation('第一次操作');
    const second = requestConfirmation('第二次操作');

    // 第一个请求仍在等待，第二个排队不弹窗也不判否
    expect(confirmationState.message).toBe('第一次操作');

    settleConfirmation(true);
    await expect(first).resolves.toBe(true);
    expect(confirmationState.isOpen).toBe(true);
    expect(confirmationState.message).toBe('第二次操作');

    settleConfirmation(false);
    await expect(second).resolves.toBe(false);
    expect(confirmationState.isOpen).toBe(false);
  });

  it('presents queued confirmations in request order', async () => {
    const first = requestConfirmation({ title: '一', message: '第一条' });
    const second = requestConfirmation({ title: '二', message: '第二条' });
    const third = requestConfirmation({ title: '三', message: '第三条' });

    settleConfirmation(false);
    expect(confirmationState.message).toBe('第二条');
    settleConfirmation(true);
    expect(confirmationState.message).toBe('第三条');
    settleConfirmation(true);

    await expect(first).resolves.toBe(false);
    await expect(second).resolves.toBe(true);
    await expect(third).resolves.toBe(true);
    expect(confirmationState.isOpen).toBe(false);
  });
});
