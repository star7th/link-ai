import { describe, it, expect } from 'vitest';

// 登录暴力破解防护：同账号全局维度，失败 10 次锁定 15 分钟；锁定期间正确密码也拒；成功清零
import {
  isLocked,
  recordFail,
  recordSuccess,
  cleanup,
  clientIpFromHeaders,
} from '@/lib/login-throttle';

describe('login-throttle', () => {
  it('失败 10 次后锁定，第 11 次正确密码也被拒（isLocked=true）', () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 10; i++) recordFail('alice', t0 + i);
    expect(isLocked('alice', t0 + 10)).toBe(true);
  });

  it('失败 9 次不锁定', () => {
    const t0 = 2_000_000;
    for (let i = 0; i < 9; i++) recordFail('bob', t0 + i);
    expect(isLocked('bob', t0 + 9)).toBe(false);
  });

  it('15 分钟后解锁（lockedUntil 过期）', () => {
    const t0 = 3_000_000;
    for (let i = 0; i < 10; i++) recordFail('carol', t0 + i);
    const lockedAt = t0 + 9;
    expect(isLocked('carol', lockedAt + 15 * 60 * 1000 - 1)).toBe(true);
    expect(isLocked('carol', lockedAt + 15 * 60 * 1000)).toBe(false);
  });

  it('15 分钟滑窗：早期失败过期后重新计数，不触发锁定', () => {
    const t0 = 4_000_000;
    const win = 15 * 60 * 1000;
    // 9 次旧失败
    for (let i = 0; i < 9; i++) recordFail('dave', t0 + i);
    // 窗口过期后再失败：滑窗重置，仅 1 次
    recordFail('dave', t0 + win + 1);
    expect(isLocked('dave', t0 + win + 1)).toBe(false);
  });

  it('账号大小写不敏感（Alice 与 alice 同 key）', () => {
    const t0 = 5_000_000;
    for (let i = 0; i < 10; i++) recordFail('Alice', t0 + i);
    expect(isLocked('alice', t0 + 10)).toBe(true);
    expect(isLocked('ALICE', t0 + 10)).toBe(true);
  });

  it('全局维度：不同来源 IP 失败共享同一账号计数', () => {
    const t0 = 6_000_000;
    // 3 个不同 IP 各失败 4 次，共 12 次 ≥ 10，应锁定
    for (let i = 0; i < 4; i++) recordFail('frank', t0 + i);
    for (let i = 0; i < 4; i++) recordFail('frank', t0 + 10 + i);
    for (let i = 0; i < 4; i++) recordFail('frank', t0 + 20 + i);
    expect(isLocked('frank', t0 + 30)).toBe(true);
  });

  it('成功登录清零计数', () => {
    const t0 = 7_000_000;
    for (let i = 0; i < 9; i++) recordFail('erin', t0 + i);
    recordSuccess('erin');
    // 再失败 9 次也不到 10，未锁定
    for (let i = 0; i < 9; i++) recordFail('erin', t0 + 10 + i);
    expect(isLocked('erin', t0 + 20)).toBe(false);
  });

  it('不同账号互不影响', () => {
    const t0 = 8_000_000;
    for (let i = 0; i < 10; i++) recordFail('grace', t0 + i);
    expect(isLocked('heidi', t0 + 10)).toBe(false);
  });

  it('cleanup 清掉过期且未锁定的条目', () => {
    const t0 = 9_000_000;
    const win = 15 * 60 * 1000;
    recordFail('old', t0);
    recordFail('locked', t0);
    for (let i = 0; i < 10; i++) recordFail('locked', t0 + 1 + i);
    cleanup(t0 + win + 1); // old 过期，locked 仍在锁定期
    expect(isLocked('old', t0 + win + 1)).toBe(false);
    expect(isLocked('locked', t0 + win + 1)).toBe(true);
  });

  it('条目上限保护：超出上限不报错（淘汰最旧）', () => {
    const t0 = 10_000_000;
    for (let i = 0; i < 10_050; i++) recordFail(`user-${i}`, t0 + i);
    expect(isLocked('nobody', t0)).toBe(false);
  });

  it('clientIpFromHeaders 取 x-forwarded-for 首段', () => {
    expect(clientIpFromHeaders({ 'x-forwarded-for': '1.1.1.1, 2.2.2.2' })).toBe('1.1.1.1');
    expect(clientIpFromHeaders({ 'x-forwarded-for': ' 3.3.3.3 ' })).toBe('3.3.3.3');
    expect(clientIpFromHeaders({})).toBe('');
  });
});
