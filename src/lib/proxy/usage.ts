/**
 * 流式 usage 相关工具：
 *
 * 1. stream_options.include_usage 注入（OpenAI 兼容协议流式请求默认不返回 usage）
 * 2. 上游拒绝注入时的回退判定
 * 3. 上游最终没返回 usage 时的本地 token 估算兜底
 */

/** OpenAI 风格协议的 provider 才注入；Anthropic 流末尾自带 usage，Responses API 另有解析逻辑 */
const NON_OPENAI_PROTOCOLS = new Set(['anthropic']);

/** 仅对 chat/completions 类路径注入（Responses API 走已有逻辑，不注入） */
export function shouldInjectStreamUsage(path: string, protocolType: string): boolean {
  if (!path || !path.includes('/completions')) return false;
  if (NON_OPENAI_PROTOCOLS.has(protocolType)) return false;
  return true;
}

export interface StreamUsageInjection {
  /** 注入后的请求体（未注入时返回原对象） */
  body: any;
  /** 是否实际注入了 include_usage */
  injected: boolean;
}

/**
 * 对流式请求体注入 stream_options.include_usage。
 * - 请求体不是普通对象 / 没有 stream 字段 → 不注入
 * - 已有 include_usage 子字段 → 完全不动（尊重客户端意图）
 * - 已有 stream_options 但无 include_usage → 只补上子字段，其余子字段保留
 */
export function injectStreamUsage(body: any): StreamUsageInjection {
  if (!isPlainObject(body) || body.stream !== true) {
    return { body, injected: false };
  }
  if (isPlainObject(body.stream_options)) {
    if ('include_usage' in body.stream_options) {
      return { body, injected: false };
    }
    return {
      body: { ...body, stream_options: { ...body.stream_options, include_usage: true } },
      injected: true,
    };
  }
  return { body: { ...body, stream_options: { include_usage: true } }, injected: true };
}

function isPlainObject(v: any): boolean {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * 上游是否因不认识 stream_options 而拒绝请求（用于回退判定）。
 * 只看 400 状态；错误文本需同时体现「未知/不支持参数」类语义。
 */
export function isStreamOptionsRejected(status: number, errorText: string): boolean {
  if (status !== 400) return false;
  const text = (errorText || '').slice(0, 4000);
  if (/stream_options|include_usage/i.test(text)) return true;
  return (
    /(unknown|unrecognized|unsupported|not supported|unexpected|extra inputs|not permitted|additional properties|invalid)/i.test(text) &&
    /(param|argument|field|property|keyword|name)/i.test(text)
  );
}

/** 进程内标记：该 provider 不支持注入，后续不再注入 */
const unsupportedInjectionProviders = new Set<string>();

/**
 * 组合判定：路径/协议是否应注入 + 该 provider 是否已被标记为不支持注入。
 * 返回的 body 即实际应转发的请求体。
 */
export function prepareStreamUsageInjection(
  body: any,
  path: string,
  protocolType: string,
  providerId: string
): StreamUsageInjection {
  if (!shouldInjectStreamUsage(path, protocolType) || isInjectionUnsupported(providerId)) {
    return { body, injected: false };
  }
  return injectStreamUsage(body);
}

/** 非流式响应文本：Responses API 取 output_text，其余取 choices[].message.content */
export function extractNonStreamResponseText(body: any, isResponsesApi: boolean): string {
  if (!body || typeof body !== 'object') return '';
  if (isResponsesApi) return extractResponsesNonStreamText(body);
  const choices = Array.isArray(body.choices) ? body.choices : [];
  const parts: string[] = [];
  for (const choice of choices) {
    const content = choice?.message?.content;
    if (typeof content === 'string') parts.push(content);
    else if (Array.isArray(content)) {
      for (const item of content) {
        if (typeof item?.text === 'string') parts.push(item.text);
      }
    }
  }
  return parts.join('');
}

export function markInjectionUnsupported(providerId: string): void {
  if (providerId) unsupportedInjectionProviders.add(providerId);
}

export function isInjectionUnsupported(providerId: string): boolean {
  return unsupportedInjectionProviders.has(providerId);
}

/** 仅测试用 */
export function resetInjectionUnsupportedForTests(): void {
  unsupportedInjectionProviders.clear();
}

/**
 * 回退：上游 400 且错误提及 stream_options/未知参数 → 剥掉注入，用原请求体重试一次。
 * 命中后给该 provider 记「不支持注入」标记，进程内后续不再注入。
 */
export async function retryWithoutInjection(
  upstream: Response,
  resend: () => Promise<Response>,
  providerId: string
): Promise<Response> {
  if (upstream.status !== 400) return upstream;
  let errorText = '';
  try {
    errorText = await upstream.text();
  } catch {
    return upstream;
  }
  if (!isStreamOptionsRejected(400, errorText)) {
    // 文本已被消费，用同内容重建响应，保证后续错误透传逻辑不变
    return new Response(errorText, { status: upstream.status, headers: upstream.headers });
  }
  markInjectionUnsupported(providerId);
  return resend();
}

/* ------------------------------------------------------------------ */
/* 本地 token 估算兜底                                                  */
/* ------------------------------------------------------------------ */

const CJK_CHAR = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af\uff66-\uff9f]/;

/**
 * 粗略口径：连续 CJK 字符约 1 字符/token，其余约 4 字符/token，向上取整。
 * 仅用于上游未返回 usage 时的统计兜底，不代表真实计费口径。
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  let tokens = 0;
  let otherRun = 0;
  const flushOther = () => {
    if (otherRun > 0) {
      tokens += Math.ceil(otherRun / 4);
      otherRun = 0;
    }
  };
  for (const ch of text) {
    if (CJK_CHAR.test(ch)) {
      flushOther();
      tokens += 1;
    } else {
      otherRun += 1;
    }
  }
  flushOther();
  return tokens;
}

import { extractResponsesNonStreamText } from '@/lib/proxy/stream';

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/**
 * 上游没返回 usage（completion 与 total 都为 0）且响应里有文本时，
 * 用响应文本估算 completionTokens 写入现有字段；有真实 usage 时完全不动。
 */
export function applyUsageFallback(usage: TokenUsage, responseText: string): TokenUsage {
  if (usage.completionTokens > 0) return usage;
  const estimated = estimateTokens(responseText);
  if (estimated <= 0) return usage;
  return {
    promptTokens: usage.promptTokens,
    completionTokens: estimated,
    totalTokens: usage.promptTokens + estimated,
  };
}
