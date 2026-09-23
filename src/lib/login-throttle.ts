/**
 * 登录暴力破解防护（纯内存实现，自托管定位；重启即清零）
 *
 * 规则：同一账号（全局维度，不区分来源 IP），15 分钟滑窗内累计失败 10 次 → 锁定 15 分钟。
 * 锁定期间直接拒绝（含正确密码）；登录成功清零计数。
 * 注意：账号级锁定存在被恶意锁定他人账号的取舍，属既定产品决策。
 */

const WINDOW_MS = 15 * 60 * 1000; // 失败计数窗口
const MAX_FAILS = 10; // 窗口内最大失败次数，达到即锁定
const LOCK_MS = 15 * 60 * 1000; // 锁定时长
const MAX_ENTRIES = 10_000; // 条目上限，超出淘汰最旧（防内存涨）

interface Entry {
  fails: number;
  windowStart: number; // 滑窗起点（首次失败时刻）
  lockedUntil: number; // 0 表示未锁定
}

const store = new Map<string, Entry>();

const keyOf = (username: string) => (username || '').toLowerCase();

/** 从请求头提取客户端 IP（与 LoginRecord 取 IP 逻辑对齐） */
export function clientIpFromHeaders(headers?: Record<string, string | string[] | undefined>): string {
  const forwarded = headers?.['x-forwarded-for'];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return raw ? raw.split(',')[0].trim() : '';
}

/** 是否处于锁定中 */
export function isLocked(username: string, now = Date.now()): boolean {
  const entry = store.get(keyOf(username));
  return !!entry && entry.lockedUntil > now;
}

/** 记录一次失败；15 分钟滑窗内达 10 次 → 锁定 15 分钟（自第 10 次失败起算） */
export function recordFail(username: string, now = Date.now()): void {
  const key = keyOf(username);
  let entry = store.get(key);
  if (!entry || now - entry.windowStart > WINDOW_MS) {
    entry = { fails: 0, windowStart: now, lockedUntil: 0 };
  }
  entry.fails += 1;
  if (entry.fails >= MAX_FAILS) {
    entry.lockedUntil = now + LOCK_MS;
  }
  // 刷新插入位置（Map 按插入序，供淘汰最旧用）
  store.delete(key);
  store.set(key, entry);
  if (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    if (oldest !== undefined) store.delete(oldest);
  }
}

/** 登录成功，清除该账号的计数与锁定 */
export function recordSuccess(username: string): void {
  store.delete(keyOf(username));
}

/** 清理过期条目（窗口外且未锁定）。可定时调用，亦在读写时惰性触发。 */
export function cleanup(now = Date.now()): void {
  for (const [key, entry] of store) {
    if (entry.lockedUntil <= now && now - entry.windowStart > WINDOW_MS) {
      store.delete(key);
    }
  }
}

// 定期清理（Node 环境；测试环境下 timer 不影响逻辑，因全部走注入的 now）
if (typeof setInterval === 'function') {
  const timer = setInterval(() => cleanup(), 10 * 60 * 1000);
  // 不阻止进程退出
  if (typeof timer.unref === 'function') {
    timer.unref();
  }
}
