import prisma from "@/lib/prisma";

interface DesensitizeRule {
  id: string;
  name: string;
  scope: string;
  ruleType: string;
  pattern: string;
  replacement: string;
  action: string;
  priority: number;
}

interface RuleHit {
  ruleName: string;
  action: string;
  matchCount: number;
}

interface ProcessRequestResult {
  content: string;
  blocked: boolean;
  hits: RuleHit[];
}

interface ProcessResponseResult {
  content: string;
  hits: RuleHit[];
}

export class DesensitizeEngine {
  private ruleCache = new Map<string, DesensitizeRule[]>();

  async loadRules(): Promise<void> {
    this.ruleCache.clear();

    const rules = await prisma.desensitizeRule.findMany({
      where: { isEnabled: true },
      orderBy: { priority: "asc" },
    });

    const tokenRuleLinks = await prisma.tokenDesensitizeRule.findMany({
      select: { tokenId: true, ruleId: true },
    });

    const tokenRuleMap = new Map<string, Set<string>>();
    for (const link of tokenRuleLinks) {
      if (!tokenRuleMap.has(link.tokenId)) {
        tokenRuleMap.set(link.tokenId, new Set());
      }
      tokenRuleMap.get(link.tokenId)!.add(link.ruleId);
    }

    const globalRules: DesensitizeRule[] = [];
    const userRulesMap = new Map<string, DesensitizeRule[]>();
    const tokenRuleIds = new Set<string>();

    for (const link of tokenRuleLinks) {
      tokenRuleIds.add(link.ruleId);
    }

    for (const rule of rules) {
      const mapped: DesensitizeRule = {
        id: rule.id,
        name: rule.name,
        scope: rule.scope,
        ruleType: rule.ruleType,
        pattern: rule.pattern,
        replacement: rule.replacement ?? "",
        action: rule.action,
        priority: rule.priority,
      };

      if (rule.scope === "global") {
        globalRules.push(mapped);
      } else if (rule.scope === "user" && rule.userId) {
        const key = `user:${rule.userId}`;
        if (!userRulesMap.has(key)) {
          userRulesMap.set(key, []);
        }
        userRulesMap.get(key)!.push(mapped);
      } else if (rule.scope === "token" && tokenRuleIds.has(rule.id)) {
        for (const [tokenId, ruleIds] of tokenRuleMap) {
          if (ruleIds.has(rule.id)) {
            const key = `token:${tokenId}`;
            if (!this.ruleCache.has(key)) {
              this.ruleCache.set(key, []);
            }
            this.ruleCache.get(key)!.push(mapped);
          }
        }
      }
    }

    this.ruleCache.set("global", globalRules);
    for (const [key, userRules] of userRulesMap) {
      this.ruleCache.set(key, userRules);
    }
  }

  async reloadRules(): Promise<void> {
    await this.loadRules();
  }

  private getApplicableRules(userId: string, tokenId: string): DesensitizeRule[] {
    const globalRules = this.ruleCache.get("global") ?? [];
    const userRules = this.ruleCache.get(`user:${userId}`) ?? [];
    const tokenRules = this.ruleCache.get(`token:${tokenId}`) ?? [];

    const all = [...globalRules, ...userRules, ...tokenRules];
    all.sort((a, b) => a.priority - b.priority);
    return all;
  }

  private applyRule(
    rule: DesensitizeRule,
    content: string,
  ): { content: string; matchCount: number } {
    let matchCount = 0;

    if (rule.ruleType === "keyword") {
      const escaped = rule.pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(escaped, "g");
      const matches = content.match(regex);
      matchCount = matches ? matches.length : 0;

      if (matchCount > 0 && rule.action === "replace") {
        content = content.replace(regex, rule.replacement);
      }
    } else if (rule.ruleType === "regex") {
      try {
        const regex = new RegExp(rule.pattern, "g");
        const matches = content.match(regex);
        matchCount = matches ? matches.length : 0;

        if (matchCount > 0 && rule.action === "replace") {
          content = content.replace(regex, rule.replacement);
        }
      } catch {
        matchCount = 0;
      }
    }

    return { content, matchCount };
  }

  async processRequest(
    userId: string,
    tokenId: string,
    content: string,
  ): Promise<ProcessRequestResult> {
    await this.loadRules();
    const rules = this.getApplicableRules(userId, tokenId);
    let result = content;
    let blocked = false;
    const hits: RuleHit[] = [];

    for (const rule of rules) {
      const applied = this.applyRule(rule, result);
      if (applied.matchCount > 0) {
        hits.push({
          ruleName: rule.name,
          action: rule.action,
          matchCount: applied.matchCount,
        });

        if (rule.action === "block") {
          blocked = true;
          break;
        }

        if (rule.action === "replace") {
          result = applied.content;
        }
      }
    }

    return { content: result, blocked, hits };
  }

  async processResponse(
    userId: string,
    tokenId: string,
    content: string,
  ): Promise<ProcessResponseResult> {
    await this.loadRules();
    const rules = this.getApplicableRules(userId, tokenId);
    let result = content;
    const hits: RuleHit[] = [];

    for (const rule of rules) {
      if (rule.action === "block") {
        continue;
      }

      const applied = this.applyRule(rule, result);
      if (applied.matchCount > 0) {
        hits.push({
          ruleName: rule.name,
          action: rule.action,
          matchCount: applied.matchCount,
        });

        if (rule.action === "replace") {
          result = applied.content;
        }
      }
    }

    return { content: result, hits };
  }
}

// 模块级单例，供 proxy route 和 API route 共享
export const desensitizeEngine = new DesensitizeEngine();
