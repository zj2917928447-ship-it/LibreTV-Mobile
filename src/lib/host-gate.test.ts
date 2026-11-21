import { describe, expect, it } from 'vitest';
import { acquireHostSlot, hostOf, withHostLimit } from './host-gate';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('hostOf', () => {
  it('取 host（含端口），非法输入原样返回', () => {
    expect(hostOf('https://a.example.com:8443/x?y=1')).toBe('a.example.com:8443');
    expect(hostOf('not-a-url')).toBe('not-a-url');
  });
});

describe('acquireHostSlot', () => {
  it('同一 host 最多 3 个在途名额，超出排队', async () => {
    const r1 = await acquireHostSlot('t-cap');
    const r2 = await acquireHostSlot('t-cap');
    const r3 = await acquireHostSlot('t-cap');
    let fourthTaken = false;
    const p4 = acquireHostSlot('t-cap').then((release) => {
      fourthTaken = true;
      return release;
    });
    await tick();
    expect(fourthTaken).toBe(false);
    r1();
    const r4 = await p4;
    expect(fourthTaken).toBe(true);
    r2();
    r3();
    r4();
  });

  it('客户端取消排队请求后立即移出 FIFO 队列，不阻塞后续请求', async () => {
    const r1 = await acquireHostSlot('t-abort-waiter');
    const r2 = await acquireHostSlot('t-abort-waiter');
    const r3 = await acquireHostSlot('t-abort-waiter');
    const client = new AbortController();
    const cancelled = acquireHostSlot('t-abort-waiter', client.signal);
    const next = acquireHostSlot('t-abort-waiter');

    client.abort();
    await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
    r1();
    const r4 = await next;

    r2();
    r3();
    r4();
  });

  it('重复释放同一个名额不会破坏并发计数', async () => {
    const r1 = await acquireHostSlot('t-release-once');
    r1();
    r1();
    const r2 = await acquireHostSlot('t-release-once');
    const r3 = await acquireHostSlot('t-release-once');
    const r4 = await acquireHostSlot('t-release-once');
    r2();
    r3();
    r4();
  });

  it('不同 host 互不影响', async () => {
    const r1 = await acquireHostSlot('t-a');
    const r2 = await acquireHostSlot('t-b');
    const r3 = await acquireHostSlot('t-c');
    r1();
    r2();
    r3();
  });

  it('名额全部释放后可立即重新获取', async () => {
    const r1 = await acquireHostSlot('t-reuse');
    r1();
    const start = Date.now();
    const r2 = await acquireHostSlot('t-reuse');
    expect(Date.now() - start).toBeLessThan(50);
    r2();
  });
});

describe('withHostLimit', () => {
  it('同一 host 的并发峰值不超过 3', async () => {
    let active = 0;
    let peak = 0;
    const task = () =>
      withHostLimit('t-peak', async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 10));
        active--;
      });
    await Promise.all(Array.from({ length: 8 }, task));
    expect(peak).toBe(3);
  });

  it('已取消的排队任务不会执行 fn', async () => {
    const r1 = await acquireHostSlot('t-cancel-fn');
    const r2 = await acquireHostSlot('t-cancel-fn');
    const r3 = await acquireHostSlot('t-cancel-fn');
    const client = new AbortController();
    let called = false;
    const pending = withHostLimit('t-cancel-fn', async () => { called = true; }, client.signal);

    client.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(called).toBe(false);
    r1();
    r2();
    r3();
  });

  it('不同 host 之间不互相等待', async () => {
    const start = Date.now();
    await Promise.all([
      withHostLimit('t-x', () => new Promise<void>((r) => setTimeout(r, 30))),
      withHostLimit('t-y', () => new Promise<void>((r) => setTimeout(r, 30))),
      withHostLimit('t-z', () => new Promise<void>((r) => setTimeout(r, 30))),
    ]);
    expect(Date.now() - start).toBeLessThan(90);
  });
});
