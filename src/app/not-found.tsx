import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-6xl font-extrabold text-accent">404</h1>
      <p className="text-muted">We couldn&apos;t find that title.</p>
      <Link
        href="/"
        className="rounded bg-foreground px-6 py-2 font-semibold text-background transition hover:bg-foreground/80"
      >
        Back to browse
      </Link>
    </main>
  );
}
