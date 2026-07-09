export const metadata = {
  title: "Tableau AI Canvas",
  description: "AI chatbot + generative canvas for Tableau dashboards"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif" }}>{children}</body>
    </html>
  );
}
