#!/bin/sh

# 确保数据目录存在
mkdir -p /app/data

# 复制环境变量文件（如果存在于数据目录）
if [ -f /app/data/.env ]; then
  echo "在数据目录中发现.env文件，正在复制到应用目录..."
  cp /app/data/.env /app/.env
  echo ".env文件复制完成"
fi

# 检查是否强制升级
if [ -f /app/data/.force-upgrade ]; then
  echo "检测到强制升级标志，将执行数据库升级..."
  # 创建升级标记文件
  touch /app/data/.db-upgrade-needed
  # 删除标志文件
  rm /app/data/.force-upgrade
  echo "升级标记已设置，应用启动时将执行数据库升级"
fi

# 检查数据库文件是否存在
if [ ! -f /app/data/app.db ]; then
  echo "数据库文件不存在，寻找预生成的模板..."
  
  # 查找模板数据库文件
  TEMPLATE_DB=$(find /app/prisma/template -name "*.db" | head -n 1)
  
  if [ -n "$TEMPLATE_DB" ]; then
    # 复制模板数据库到数据目录
    cp "$TEMPLATE_DB" /app/data/app.db
    echo "数据库初始化完成"
  else
    echo "警告：未找到模板数据库，创建空数据库文件..."
    # 创建空数据库文件，让应用可以启动
    touch /app/data/app.db
    echo "已创建空数据库文件，可能需要手动初始化"
  fi
else
  echo "数据库文件已存在，无需初始化"
fi

# 检查是否需要创建.env文件（无论数据库是否存在）
if [ ! -f /app/data/.env ]; then
  echo "创建.env文件到数据目录..."
  RANDOM_SECRET=$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')
  echo "# NextAuth.js 密钥" > /app/data/.env
  echo "NEXTAUTH_SECRET=$RANDOM_SECRET" >> /app/data/.env
  echo ".env文件已创建到数据目录"
  
  # 复制.env文件到应用目录
  cp /app/data/.env /app/.env
  echo ".env文件已复制到应用目录"
fi

# 启动应用
echo "启动应用..."
exec node server.js 