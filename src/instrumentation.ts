export async function register() {
  // 仅在服务器端运行
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    try {
      // 动态导入启动模块并执行初始化（必须 await 确保引擎初始化完成后再接收请求）
      const { initSystem } = await import('./lib/startup');
      await initSystem();
      console.log('系统通过instrumentation初始化触发');
    } catch (error) {
      console.error('通过instrumentation初始化系统失败:', error);
    }
  }
} 