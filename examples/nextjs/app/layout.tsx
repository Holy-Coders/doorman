import type { ReactNode } from "react";
export const metadata = { title: "Visitor identity example" };
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: "system-ui",
          maxWidth: "44rem",
          margin: "4rem auto",
          padding: "1rem",
          lineHeight: 1.6,
        }}
      >
        {children}
      </body>
    </html>
  );
}
