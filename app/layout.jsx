// app/layout.jsx
import "./globals.css";

export const metadata = {
  title: "Lorcana Price Finder — JustTCG",
  description: "Secure Next.js proxy to JustTCG for Disney Lorcana prices.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
