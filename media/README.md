# Local media (dev)

Drop your dev video files here. This folder is tracked by git but its contents
are **gitignored** (only this README is committed), so large videos never get
checked in.

## Usage

1. Copy a video into this folder, e.g. `media/inception.mp4`.
2. Reference it from [`src/scripts/library.config.ts`](../src/scripts/library.config.ts)
   using a path relative to the project root (it's resolved to an absolute path
   at ingest time):

   ```ts
   export const library: LibraryEntry[] = [
     {
       type: "movie",
       filePath: "./media/inception.mp4",
       tmdbId: 27205, // from https://www.themoviedb.org/movie/27205
     },
   ];

   export const collections: CollectionConfig[] = [
     { slug: "featured", title: "Featured", kind: "hero", items: [{ type: "movie", tmdbId: 27205 }] },
     { slug: "my-movies", title: "My Movies", kind: "row", sortOrder: 1, items: [{ type: "movie", tmdbId: 27205 }] },
   ];
   ```

3. Run `npm run ingest`, then `npm run dev` and browse to the home page.

## Notes

- Files can live anywhere on disk — this folder is just a convenient default.
  Any absolute or project-relative path works in `library.config.ts`.
- Use browser-playable containers: **.mp4** (H.264/AAC) or **.webm**. `.mkv`
  is recorded but most browsers can't decode it natively.
- The streaming endpoint re-reads the file from disk on every request, so you
  can swap a file in place without re-ingesting (as long as the path is the same).
