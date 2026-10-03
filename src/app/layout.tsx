import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { integrations } from "@/core/config";

export const metadata: Metadata = {
  title: "Show it once",
  description: "Teach an agent your recurring workflow from past work, prove it matches you, then let it run on Agent37.",
};

export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const ints = integrations();
  return (
    <html lang="en">
      <body>
        <div className="shell">
          <header className="topbar">
            <Link href="/" className="brand">
              <span className="brand-mark">S</span>
              <span>Show it once</span>
              <span className="faint small" style={{ fontWeight: 400 }}>prove it works, let it run</span>
            </Link>
            <div className="integrations">
              {Object.values(ints).map((i) => (
                <span key={i.label} className={`chip ${i.on ? "on" : ""}`} title={i.on ? "Connected" : "Offline fallback"}>
                  <span className="dot" />
                  {i.label}
                </span>
              ))}
            </div>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
