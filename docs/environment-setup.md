# LinkAI 环境搭建备忘

快速搭建 LinkAI 开发环境的参考文档。

---

## 技术栈

基于 **CoolStartup** 脚手架：

- Next.js 15
- React 19
- TypeScript
- Prisma
- SQLite

---

## 快速启动

```bash
cd /mnt/hgfs/shareToOpenclaw/link-ai
npm install
npm run dev
```

`npm run dev` 会自动执行 `prisma generate` 并使用 Turbopack 启动开发服务器。

开发服务器默认监听 **3002** 端口（3000/3001 被 Windows 宿主机占用）。

---

## 数据库

- 类型：SQLite
- 位置：`data/app.db`
- 迁移：`npx prisma migrate dev`
- 重置：`npx prisma migrate reset`

---

## 环境变量

在项目根目录 `.env` 文件中配置：

```env
NEXTAUTH_SECRET=your-secret-here
```

---

## hgfs 环境特殊配置

在 VMware 共享文件夹 (`/mnt/hgfs/`) 下开发时，需在 `next.config.js` 中设置：

```js
distDir: '/tmp/linkai-next-cache/.next'
```

详见 [testing-guide.md](./testing-guide.md#一vmware-共享文件夹-hgfs-环境注意事项)。

---

## Docker 部署

```bash
docker-compose up -d
```

配置文件：`docker-compose.yml`。
