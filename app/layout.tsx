import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "GPTML AI",
  description: "Агрегатор нейросетей",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <head>
        <script
          // Sets theme before first paint to avoid dark flash.
          dangerouslySetInnerHTML={{
            __html: `(function () {
  try {
    var key = 'theme-preference';
    var saved = localStorage.getItem(key);
    var theme = (saved === 'light' || saved === 'dark')
      ? saved
      : (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    document.documentElement.setAttribute('data-theme', theme);
  } catch (e) {}
})();`,
          }}
        />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
