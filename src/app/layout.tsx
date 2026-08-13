import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { GlobalThemeBackground } from "@/components/theme/GlobalThemeBackground";

export const metadata: Metadata = {
  title: "Birdserver V1",
  description: "Birdserver V1 modern server management panel by BimzOfficial.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-black text-white antialiased">
        <GlobalThemeBackground />
        <div className="relative z-10 min-h-screen">{children}</div>
      </body>
    </html>
  );
}
