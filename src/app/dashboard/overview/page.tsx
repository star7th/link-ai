"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import Link from "next/link"

interface UsageData {
  period: string
  usage: {
    tokens: number
    requests: number
    tokenLimit: number
    requestLimit: number
    tokenUsagePercent: number
    requestUsagePercent: number
  }
}

interface TokensData {
  tokens: { id: string; name: string; active: boolean }[]
}

export default function OverviewPage() {
  const [usage, setUsage] = useState<UsageData | null>(null)
  const [tokensData, setTokensData] = useState<TokensData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchData() {
      try {
        const [usageRes, tokensRes] = await Promise.all([
          fetch("/api/user/usage"),
          fetch("/api/user/tokens"),
        ])
        if (usageRes.ok) {
          setUsage(await usageRes.json())
        }
        if (tokensRes.ok) {
          setTokensData(await tokensRes.json())
        }
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [])

  const activeTokens = tokensData?.tokens.filter((t) => t.active).length ?? 0

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-light-text-primary dark:text-dark-text-primary">
        概览
      </h1>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-light-text-tertiary dark:text-dark-text-tertiary">
              总请求数（本月）
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="h-8 w-24 animate-pulse rounded bg-primary/10 dark:bg-primary/15" />
            ) : (
              <p className="text-3xl font-bold text-light-text-primary dark:text-dark-text-primary">
                {usage?.usage.requests.toLocaleString() ?? "—"}
              </p>
            )}
            {usage?.usage && usage.usage.requestLimit > 0 && (
              <div className="mt-3 space-y-1">
                <div className="flex justify-between text-xs text-light-text-tertiary dark:text-dark-text-tertiary">
                  <span>配额使用</span>
                  <span>
                    {usage.usage.requests.toLocaleString()} /{" "}
                    {usage.usage.requestLimit!.toLocaleString()}
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-primary/10 dark:bg-primary/15">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{
                      width: `${Math.min(usage.usage.requestUsagePercent, 100)}%`,
                    }}
                  />
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-light-text-tertiary dark:text-dark-text-tertiary">
              总 Token 数（本月）
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="h-8 w-24 animate-pulse rounded bg-primary/10 dark:bg-primary/15" />
            ) : (
              <p className="text-3xl font-bold text-light-text-primary dark:text-dark-text-primary">
                {usage?.usage.tokens.toLocaleString() ?? "—"}
              </p>
            )}
            {usage?.usage && usage.usage.tokenLimit > 0 && (
              <div className="mt-3 space-y-1">
                <div className="flex justify-between text-xs text-light-text-tertiary dark:text-dark-text-tertiary">
                  <span>配额使用</span>
                  <span>
                    {usage.usage.tokens.toLocaleString()} /{" "}
                    {usage.usage.tokenLimit!.toLocaleString()}
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-primary/10 dark:bg-primary/15">
                  <div
                    className={`h-full rounded-full transition-all ${
                      usage.usage.tokenUsagePercent > 90
                        ? "bg-error"
                        : usage.usage.tokenUsagePercent > 70
                          ? "bg-warning"
                          : "bg-success"
                    }`}
                    style={{
                      width: `${Math.min(usage.usage.tokenUsagePercent, 100)}%`,
                    }}
                  />
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-light-text-tertiary dark:text-dark-text-tertiary">
              可用令牌
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="h-8 w-24 animate-pulse rounded bg-primary/10 dark:bg-primary/15" />
            ) : (
              <p className="text-3xl font-bold text-light-text-primary dark:text-dark-text-primary">
                {activeTokens}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-semibold text-light-text-primary dark:text-dark-text-primary">
            快速开始
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="space-y-4">
            <li className="flex items-start gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary dark:bg-primary/15 dark:text-primary">
                1
              </span>
              <div>
                <p className="font-medium text-light-text-primary dark:text-dark-text-primary">
                  创建 API 令牌
                </p>
                <p className="text-sm text-light-text-tertiary dark:text-dark-text-tertiary">
                  生成一个 API 密钥用于访问服务接口。
                </p>
                <Link href="/dashboard/tokens" className="mt-2 inline-flex items-center justify-center rounded-md text-sm font-medium h-9 px-3 border border-primary/20 dark:border-primary/30 hover:bg-primary/5 transition-all duration-200">前往创建</Link>
              </div>
            </li>
            <li className="flex items-start gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary dark:bg-primary/15 dark:text-primary">
                2
              </span>
              <div>
                <p className="font-medium text-light-text-primary dark:text-dark-text-primary">
                  配置上游提供商
                </p>
                <p className="text-sm text-light-text-tertiary dark:text-dark-text-tertiary">
                  添加 OpenAI、Claude 等模型提供商的 API 密钥。
                </p>
                <Link href="/dashboard/usage" className="mt-2 inline-flex items-center justify-center rounded-md text-sm font-medium h-9 px-3 border border-primary/20 dark:border-primary/30 hover:bg-primary/5 transition-all duration-200">前往查看</Link>
              </div>
            </li>
            <li className="flex items-start gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary dark:bg-primary/15 dark:text-primary">
                3
              </span>
              <div>
                <p className="font-medium text-light-text-primary dark:text-dark-text-primary">
                  开始使用
                </p>
                <p className="text-sm text-light-text-tertiary dark:text-dark-text-tertiary">
                  使用令牌调用 API，开始您的 AI 之旅。
                </p>
                <Link href="/docs" className="mt-2 inline-flex items-center justify-center rounded-md text-sm font-medium h-9 px-3 border border-primary/20 dark:border-primary/30 hover:bg-primary/5 transition-all duration-200">查看文档</Link>
              </div>
            </li>
          </ol>
        </CardContent>
      </Card>
    </div>
  )
}
