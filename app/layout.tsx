import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Outlier Report | Auxiliary Usage",
  description:
    "A secure WFM dashboard for comparing scheduled and actual auxiliary usage from Assembled.",
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
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
