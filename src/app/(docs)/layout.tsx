export default function DocsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-mk-bg text-mk-text flex flex-col light">
      {children}
    </div>
  );
}
