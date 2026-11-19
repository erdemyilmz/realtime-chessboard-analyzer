import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Boardlight — Chessboard photo analysis",
  description:
    "Photograph a chessboard, review your position, and explore with Stockfish.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
