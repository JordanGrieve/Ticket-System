import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans, Spline_Sans_Mono } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

const splineMono = Spline_Sans_Mono({
  variable: "--font-spline-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Postbox — support tickets that feel like an inbox",
  description:
    "Turn contact-form submissions and inbound email into a clean, threaded support inbox. One workspace, one API key.",
};

/**
 * Browser chrome colour, and safe-area handling for installed PWAs.
 *
 * These meta tags take precedence over the manifest's theme_color where both
 * apply, so the manifest value stays as the backstop for the installed app
 * while tabs get a value that at least follows the device's light/dark
 * preference.
 *
 * KNOWN CEILING: media queries can only see the system preference. The three
 * named themes (forest, slate, ocean) are set via a data-theme attribute, which
 * CSS media queries cannot observe — a workspace on Ocean gets the light or
 * dark chrome colour, not a blue one. Matching those needs a client effect
 * rewriting this tag on theme change, which is not worth a hydration-time
 * flicker for a strip of browser chrome.
 *
 * viewportFit: "cover" is what lets the layout paint into the notch area on
 * an installed iOS PWA instead of letterboxing with white bars.
 */
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#dcd3f5" },
    { media: "(prefers-color-scheme: dark)", color: "#141126" },
  ],
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${jakarta.variable} ${splineMono.variable}`}>
      <body>
        <ClerkProvider>{children}</ClerkProvider>
      </body>
    </html>
  );
}
