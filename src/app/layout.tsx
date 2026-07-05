import type { Metadata } from "next";
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
  title: "Personal Media Host",
  description: "Your self-hosted, Netflix-style media library.",
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
