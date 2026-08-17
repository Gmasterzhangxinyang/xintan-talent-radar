import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.includes("localhost") ? "http" : "https");
  const imageUrl = `${protocol}://${host}/og.png`;
  const description = "从公开社媒内容中识别人才流动与企业异动线索，保留证据并按价值排序。";
  return {
    title: "芯探｜芯片猎头社媒情报助手",
    description,
    openGraph: {
      title: "芯探｜芯片猎头社媒情报助手",
      description,
      images: [{ url: imageUrl, width: 1680, height: 945, alt: "芯探社媒情报助手" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "芯探｜芯片猎头社媒情报助手",
      description,
      images: [imageUrl],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
