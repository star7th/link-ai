// @ts-check

/** @type {import('next').NextConfig} */
const nextConfig = {
  /* config options here */
  output: 'standalone',

  async rewrites() {
    return [
      {
        source: '/v1/:path*',
        destination: '/api/proxy/v1/:path*',
      },
      {
        source: '/:path((?!api|_next|admin|dashboard|auth|setup|v1).*)',
        destination: '/api/proxy/v1/:path*',
      },
    ];
  },
  
  // 启用instrumentation功能
  // Next.js 15中不再需要experimental配置，instrumentation功能已默认启用
  
  webpack: (config) => {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      net: false,
      tls: false,
      dns: false,
      fs: false,
    };
    
    // 添加对opentelemetry包的警告忽略
    config.ignoreWarnings = [
      ...(config.ignoreWarnings || []),
      { module: /opentelemetry/ }
    ];
    
    return config;
  },
  // 设置服务端默认端口
  env: {
    PORT: '3333',
  },
  typescript: {
    ignoreBuildErrors: true
  }
};

module.exports = nextConfig; 