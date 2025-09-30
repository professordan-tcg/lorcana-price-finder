import "./globals.css";
import React from "react";


export const metadata = {
title: "Lorcana Price Finder — JustTCG",
description: "Secure Next.js proxy to JustTCG for Disney Lorcana prices.",
};


export default function RootLayout({ children }: { children: React.ReactNode }) {
return (
<html lang="en">
<body>{children}</body>
</html>
);
}
