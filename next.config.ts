import type { NextConfig } from "next";

/** 폰 LAN 테스트: Next 16은 다른 호스트의 개발 서버 요청을 기본 차단한다. 노트북 IP를 DEV_LAN_HOSTS(쉼표 구분)에 넣는다. */
const lanHosts = (process.env.DEV_LAN_HOSTS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  allowedDevOrigins: ["192.168.*.*", "172.20.10.*", "10.*.*.*", ...lanHosts],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
