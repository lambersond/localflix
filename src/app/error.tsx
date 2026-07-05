"use client";

export default function Error({
  reset,
}: Readonly<{
  error: Error & { digest?: string };
  reset: () => void;
}>) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-3xl font-bold">Something went wrong</h1>
      <p className="text-muted">An unexpected error occurred while loading this page.</p>
      <button
        type="button"
        onClick={reset}
        className="rounded bg-foreground px-6 py-2 font-semibold text-background transition hover:bg-foreground/80"
      >
        Try again
      </button>
    </main>
  );
}
