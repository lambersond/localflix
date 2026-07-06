import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Navbar from "./components/common/Navbar";
import ProfileGate from "./components/profile/ProfileGate";
import { listProfiles } from "@/db/queries";
import { getActiveProfile } from "@/lib/profile";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "LocalFlix",
  description: "LocalFlix — your self-hosted, Netflix-style media library.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0a0a0a",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const activeProfile = await getActiveProfile();
  const profiles = listProfiles();

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {activeProfile ? (
          <>
            <Navbar activeProfile={activeProfile} profiles={profiles} />
            {children}
          </>
        ) : (
          <ProfileGate profiles={profiles} />
        )}
      </body>
    </html>
  );
}
