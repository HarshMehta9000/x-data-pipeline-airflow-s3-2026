import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ThemeToggle } from "@/components/ThemeToggle";

export const metadata: Metadata = {
  metadataBase: new URL("https://x-data-pipeline.vercel.app"),
  title: "The DAG is green and the data is wrong",
  description:
    "An Airflow pipeline simulated in the browser, running the repo's real extract, transform and load logic, to show what ninety days of green runs actually write to the lake.",
  openGraph: {
    title: "Every run is green. The data is wrong.",
    description:
      "Ninety scheduled runs, ninety successes, and every post in the lake 6.8 times. Measured, not asserted.",
    images: [{ url: "/og.png", width: 1200, height: 630 }],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    images: ["/og.png"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

// Runs before paint so the first frame is already in the right theme, and so
// the stamped attribute exists for every component that reads it.
const THEME_SCRIPT = `(function(){try{var s=localStorage.getItem("xdp-theme");var m=window.matchMedia("(prefers-color-scheme: dark)").matches;document.documentElement.setAttribute("data-theme",s==="light"||s==="dark"?s:(m?"dark":"light"));}catch(e){document.documentElement.setAttribute("data-theme","light");}})();`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <ThemeToggle />
        {children}
      </body>
    </html>
  );
}
