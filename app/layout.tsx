import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "pulse/08 · 你的健康地图，一次读懂一个信号",
  description: "一份由服务端计算、围绕你真实节奏生成的私密健康地图。",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
