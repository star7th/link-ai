# 构建阶段
FROM node:20-alpine AS builder

WORKDIR /app

# 复制依赖文件
COPY package.json package-lock.json* ./

# 安装依赖
RUN npm ci

# 复制源代码
COPY . .

# 生成Prisma客户端
RUN npx prisma generate

# 预先生成SQLite数据库，并确保创建成功
RUN mkdir -p /app/prisma/template && \
    echo "正在生成数据库模板..." && \
    npx prisma migrate deploy && \
    DB_FILE=$(find /app -name "*.db" -type f | head -n 1) && \
    if [ -n "$DB_FILE" ]; then \
      echo "找到数据库文件: $DB_FILE" && \
      cp "$DB_FILE" /app/prisma/template/link-ai.db && \
      echo "数据库模板已保存到: /app/prisma/template/link-ai.db"; \
    else \
      echo "警告: 未找到数据库文件!" && \
      touch /app/prisma/template/coolmonitor.db && \
      echo "已创建空的数据库模板文件"; \
    fi

# 构建应用
RUN npm run build

# 检查并确保Prisma客户端正确包含在构建产物中
RUN echo "检查standalone目录中的Prisma客户端..." && \
    if [ ! -d "/app/.next/standalone/node_modules/.prisma" ] || [ ! -d "/app/.next/standalone/node_modules/@prisma/client" ]; then \
      echo "Prisma客户端不完整，正在手动复制..." && \
      mkdir -p /app/.next/standalone/node_modules/.prisma && \
      cp -r /app/node_modules/.prisma/* /app/.next/standalone/node_modules/.prisma/ 2>/dev/null || echo "复制.prisma目录失败" && \
      mkdir -p /app/.next/standalone/node_modules/@prisma/client && \
      cp -r /app/node_modules/@prisma/client/* /app/.next/standalone/node_modules/@prisma/client/ 2>/dev/null || echo "复制@prisma/client目录失败"; \
    else \
      echo "✓ Prisma客户端已正确包含在构建产物中"; \
    fi

# 中间阶段 - 提取相关文件并删除不必要的依赖
FROM node:20-alpine AS extractor

WORKDIR /app

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma/template ./prisma/template
COPY --from=builder /app/startup.sh ./startup.sh

# 确认Prisma客户端存在
RUN echo "确认Prisma客户端目录存在..." && \
    if [ -d "./node_modules/.prisma" ] && [ -d "./node_modules/@prisma/client" ]; then \
      echo "✓ Prisma客户端已成功复制"; \
    else \
      echo "✗ Prisma客户端缺失，构建可能有问题！"; \
      exit 1; \
    fi

# 清理不必要的文件和目录
RUN find . -name "*.map" -type f -delete && \
    find . -path "*/node_modules/.bin/*" -delete && \
    find ./node_modules -name "README*" -delete && \
    find ./node_modules -name "readme*" -delete && \
    find ./node_modules -name "CHANGELOG*" -delete && \
    find ./node_modules -name "LICENSE*" -delete && \
    find ./node_modules -name "*.d.ts" -delete && \
    find ./node_modules -path "*/test/*" -delete && \
    find ./node_modules -path "*/tests/*" -delete && \
    find ./node_modules -path "*/.github/*" -delete

# 生产阶段
FROM alpine:3.19 AS runner

# 安装Node.js运行时，不安装npm等开发工具
RUN apk add --no-cache nodejs

WORKDIR /app

# 安装dos2unix进行行尾处理
RUN apk add --no-cache dos2unix

# 复制应用文件
COPY --from=extractor /app ./

# 处理启动脚本
RUN dos2unix ./startup.sh && \
    chmod +x ./startup.sh && \
    apk del --purge dos2unix

# 创建数据目录并设置权限
RUN mkdir -p /app/data

# 使用root用户运行，不再创建非root用户
# 注释掉创建用户的命令
# RUN addgroup -S nodejs && \
#     adduser -S nextjs -G nodejs && \
#     mkdir -p /app/data && \
#     chown -R nextjs:nodejs /app

# 注释掉切换用户的命令
# USER nextjs

EXPOSE 3333

ENV PORT=3333
ENV HOSTNAME="0.0.0.0"
ENV NODE_ENV=production

# 数据卷 - 用于SQLite数据库文件
VOLUME ["/app/data"]

# 启动应用
CMD ["./startup.sh"] 