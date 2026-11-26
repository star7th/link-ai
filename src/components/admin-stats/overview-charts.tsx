'use client';

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { StatsTrendPoint } from '@/lib/admin-stats';

function formatCompact(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

const AXIS_COLOR = 'var(--recharts-axis, #9ca3af)';
const GRID_COLOR = 'var(--recharts-grid, rgba(128,128,128,0.2))';

const tooltipStyle = {
  borderRadius: 8,
  border: '1px solid rgba(128,128,128,0.3)',
  fontSize: 12,
};

interface ChartProps {
  data: StatsTrendPoint[];
  /** hour = 今天按小时，day = 按天 */
  bucket: 'hour' | 'day';
}

/** Token 用量走势：输入 / 输出堆叠柱状图 */
export function TokenTrendChart({ data, bucket }: ChartProps) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 11, fill: AXIS_COLOR }}
          stroke={AXIS_COLOR}
          interval={bucket === 'hour' ? 2 : 'preserveStartEnd'}
        />
        <YAxis
          tick={{ fontSize: 11, fill: AXIS_COLOR }}
          stroke={AXIS_COLOR}
          tickFormatter={(v) => formatCompact(Number(v))}
          width={56}
        />
        <Tooltip
          contentStyle={tooltipStyle}
          formatter={(value, name) => [
            Number(value).toLocaleString(),
            name === 'promptTokens' ? '输入' : '输出',
          ]}
          labelFormatter={(label) => `${bucket === 'hour' ? '时段' : '日期'} ${label}`}
        />
        <Legend formatter={(v) => (v === 'promptTokens' ? '输入 Token' : '输出 Token')} />
        <Bar dataKey="promptTokens" stackId="token" fill="#60a5fa" />
        <Bar dataKey="completionTokens" stackId="token" fill="#34d399" />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** 请求量走势：折线（成功 / 错误分色） */
export function RequestTrendChart({ data, bucket }: ChartProps) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <AreaChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="reqFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#a78bfa" stopOpacity={0.5} />
            <stop offset="100%" stopColor="#a78bfa" stopOpacity={0.05} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 11, fill: AXIS_COLOR }}
          stroke={AXIS_COLOR}
          interval={bucket === 'hour' ? 2 : 'preserveStartEnd'}
        />
        <YAxis
          tick={{ fontSize: 11, fill: AXIS_COLOR }}
          stroke={AXIS_COLOR}
          tickFormatter={(v) => formatCompact(Number(v))}
          width={48}
          allowDecimals={false}
        />
        <Tooltip
          contentStyle={tooltipStyle}
          formatter={(value, name) => [
            Number(value).toLocaleString(),
            name === 'requests' ? '请求数' : name === 'errors' ? '错误数' : '成功数',
          ]}
          labelFormatter={(label) => `${bucket === 'hour' ? '时段' : '日期'} ${label}`}
        />
        <Legend formatter={(v) => (v === 'requests' ? '请求数' : v === 'errors' ? '错误数' : '成功数')} />
        <Area type="monotone" dataKey="requests" stroke="#a78bfa" strokeWidth={2} fill="url(#reqFill)" />
        <Line type="monotone" dataKey="success" stroke="#34d399" strokeWidth={1.5} dot={false} />
        <Line type="monotone" dataKey="errors" stroke="#f87171" strokeWidth={1.5} dot={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
