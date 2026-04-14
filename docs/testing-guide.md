# LinkAI 测试指南

本文档记录在开发和测试 LinkAI 项目过程中积累的经验、踩过的坑以及注意事项，供后续子任务和 Claude Code 参考。

---

## 一、VMware 共享文件夹 (hgfs) 环境注意事项

### 问题

Next.js 在 VMware 共享文件夹 (`/mnt/hgfs/`) 上无法正常写入原子文件（如 `_buildManifest.js.tmp.*`），导致编译产物损坏，页面加载时报错。

### 解决方案

使用 bind mount 将 `.next` 缓存目录映射到原生文件系统（`/tmp`）。hgfs 不支持符号链接，必须用 bind mount：

```bash
# 1. 创建 /tmp 缓存目录
mkdir -p /tmp/linkai-next-cache

# 2. 创建项目中的 .next 目录作为挂载点
mkdir -p /mnt/hgfs/shareToOpenclaw/link-ai/.next

# 3. bind mount（需要 sudo）
sudo mount --bind /tmp/linkai-next-cache /mnt/hgfs/shareToOpenclaw/link-ai/.next
```

`next.config.js` 中**不需要** `distDir` 配置。Next.js 默认写入 `.next` 目录，通过 bind mount 实际写入 `/tmp`。

> ⚠️ `distDir` 方案已废弃：Next.js 会将绝对路径解析为项目相对路径，导致缓存仍然落在 hgfs 上，无法解决问题。
>
> ⚠️ bind mount 是临时方案，**不要加入 `/etc/fstab` 开机启动**。仅在开发时手动执行即可。虚拟机重启后需要重新 mount。

### 状态

✅ 已改为 bind mount 方案。重启后需重新执行 mount 命令。

---

## 二、浏览器自动化填写 React 受控表单

### 背景

LinkAI 使用 **shadcn/ui** 风格的 React 受控组件（非 Ant Design）。常规的 Playwright `type`/`fill` 只修改 DOM，不会同步 React 内部状态，导致表单提交时数据为空。

### ✅ 有效方案：通过 React fiber 的 useState dispatch 直接注入表单状态

```javascript
const fillReactForm = async (selector, formData) => {
  // 1. 找到表单内任意一个 input 元素
  const input = document.querySelector(`${selector} input`);
  if (!input) throw new Error('No input found in form');

  // 2. 沿 fiber 树向上查找目标 React 组件
  const reactKey = Object.keys(input).find(k => k.startsWith('__reactFiber$'));
  let fiber = input[reactKey];
  while (fiber) {
    if (fiber.type?.name === '目标组件名') break;
    fiber = fiber.return;
  }
  if (!fiber) throw new Error('Target component not found in fiber tree');

  // 3. 获取 useState 的 dispatch 函数
  const dispatch = fiber.memoizedState.queue.dispatch;

  // 4. 用 updater function 一次性设置所有字段
  dispatch(prev => ({ ...prev, ...formData }));

  // 5. 等待 React 渲染完成
  return new Promise(resolve => {
    requestAnimationFrame(() => {
      requestAnimationFrame(resolve);
    });
  });
};
```

### ✅ 备选方案：原生 value setter + 事件触发

某些页面（如 profile）的 React dispatch 不生效，可用原生方式：

```javascript
const input = document.querySelector('input[name="fieldName"]');
const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
setter.call(input, '新值');
input.dispatchEvent(new Event('input', { bubbles: true }));
input.dispatchEvent(new Event('change', { bubbles: true }));
```

适用于单字段简单修改场景。多字段表单仍优先用 dispatch 方案。

### ❌ 不可用的方案

| 方案 | 原因 |
|---|---|
| Playwright `type` | DOM 改了但 React 状态不同步 |
| Playwright `fill` | 需要 snapshot 获取 ref，且同样有状态同步问题 |
| React fiber `onChange` 逐个调用 | React 18 闭包捕获导致多字段同步不可可靠 |

### 通用步骤

1. 从 input 元素的 `__reactFiber$` 属性开始
2. 沿 fiber 树 `return` 向上找到目标组件
3. `memoizedState` 链表中找第一个有 `queue.dispatch` 的节点（通常是表单 state）
4. 用 `dispatch(prev => ({...prev, ...formData}))` 一次性设置
5. 双重 `requestAnimationFrame` 等渲染
6. 按钮 click 无需特殊处理

---

## 三、OpenClaw Browser 工具注意事项

在 WebTop 环境下使用 OpenClaw 的 browser 工具时：

- 🚫 **绝对不要用 `browser snapshot`** —— 会超时
- ✅ 只用 `browser open` + `browser screenshot` + `browser act`
- ✅ 截图用 `browser screenshot`（不是 snapshot）
- ⏱️ 每个页面操作后等 **3 秒**，让 Next.js 编译完成

---

## 四、开发服务器管理

### 端口

- 端口 3000/3001 被 Windows 宿主机占用
- 项目使用 **3002** 端口：`npm run dev` 默认监听 3002

### 进程管理

- ❌ 不要用 `pkill -9 -f "next dev"` —— 会把当前进程也杀掉
- ✅ 使用 `kill <pid>` 精确杀进程

### 编译等待

- 首次请求页面编译需 **10s+**
- 用 curl 测试时要加 `--max-time 30`

---

## 五、已验证的页面状态

### 页面渲染

✅ 17 个页面全部正常渲染（含修复后的 `/admin/security`）

### API 接口

✅ 全部返回 200，覆盖以下模块：

- 认证（登录/登出/会话）
- CRUD 操作
- 代理转发
- 审计日志
- 配额管理
