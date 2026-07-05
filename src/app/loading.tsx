export default function Loading() {
  return (
    <main className="flex flex-col gap-8 pt-24">
      <div className="h-[56vw] max-h-[80vh] min-h-[420px] w-full animate-pulse bg-surface" />
      <div className="flex flex-col gap-8 px-4 sm:px-8">
        {[0, 1].map((row) => (
          <div key={row} className="flex flex-col gap-2">
            <div className="h-5 w-40 animate-pulse rounded bg-surface" />
            <div className="flex gap-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="aspect-[2/3] w-[150px] shrink-0 animate-pulse rounded-md bg-surface sm:w-[170px]"
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
