/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // PGlite 带 WASM 和原生文件系统访问，不能让 Next 打包进 server bundle，
  // 否则 build 会报 "wasm module not found" 之类的错。
  // 这一行是 v0.2 真实踩出来的，不是可选优化。
  serverExternalPackages: ['@electric-sql/pglite'],
}

export default nextConfig
