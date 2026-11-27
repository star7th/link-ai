import { describe, expect, it } from 'vitest';
import {
  accumulateDecodeSamples,
  isValidDecodeSample,
  type DecodeSample,
  type Acc,
} from '../token-speed';

const sample = (overrides: Partial<DecodeSample> = {}): DecodeSample => ({
  providerId: 'p1',
  model: 'm1',
  responseTime: 1000,
  ttftMs: 200,
  ...overrides,
});

const newAcc = (): Acc => new Map();

describe('isValidDecodeSample', () => {
  it('ttftMs 缺失（null）的记录不参与 decode 分母', () => {
    expect(isValidDecodeSample({ responseTime: 1000, ttftMs: null })).toBe(false);
  });

  it('ttftMs 异常（负数或 >= responseTime）的记录不参与 decode 分母', () => {
    expect(isValidDecodeSample({ responseTime: 1000, ttftMs: -1 })).toBe(false);
    expect(isValidDecodeSample({ responseTime: 1000, ttftMs: 1000 })).toBe(false);
    expect(isValidDecodeSample({ responseTime: 1000, ttftMs: 1200 })).toBe(false);
  });

  it('0 <= ttftMs < responseTime 的记录有效', () => {
    expect(isValidDecodeSample({ responseTime: 1000, ttftMs: 0 })).toBe(true);
    expect(isValidDecodeSample({ responseTime: 1000, ttftMs: 999 })).toBe(true);
  });
});

describe('accumulateDecodeSamples', () => {
  it('decode 分母 = Σ(responseTime − ttftMs)', () => {
    const acc = newAcc();
    accumulateDecodeSamples(
      [
        sample({ responseTime: 1000, ttftMs: 200 }),
        sample({ model: 'm2', responseTime: 2000, ttftMs: 500 }),
      ],
      acc
    );
    // 整体：(1000-200) + (2000-500) = 2300
    expect(acc.get('p1')?.decodeMs).toBe(2300);
    // 按模型各自累计
    expect(acc.get('p1')?.models.get('m1')?.decodeMs).toBe(800);
    expect(acc.get('p1')?.models.get('m2')?.decodeMs).toBe(1500);
  });

  it('ttftMs 缺失记录被剔除：不计入分母，有效记录正常累计', () => {
    const acc = newAcc();
    accumulateDecodeSamples(
      [
        sample({ responseTime: 1000, ttftMs: null }), // 缺失，剔除
        sample({ responseTime: 1500, ttftMs: 300 }), // 有效
      ],
      acc
    );
    expect(acc.get('p1')?.decodeMs).toBe(1200);
    expect(acc.get('p1')?.models.get('m1')?.decodeMs).toBe(1200);
  });

  it('全部记录被剔除后无有效样本，decodeMs 保持 0（tokPerSec 会返回 null）', () => {
    const acc = newAcc();
    accumulateDecodeSamples(
      [sample({ responseTime: 1000, ttftMs: null }), sample({ responseTime: 500, ttftMs: 500 })],
      acc
    );
    expect(acc.size).toBe(0);
  });

  it('model 为 null 的记录只计入整体分母，不进按模型明细', () => {
    const acc = newAcc();
    accumulateDecodeSamples([sample({ model: null, responseTime: 1200, ttftMs: 200 })], acc);
    expect(acc.get('p1')?.decodeMs).toBe(1000);
    expect(acc.get('p1')?.models.size).toBe(0);
  });
});
