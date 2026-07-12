interface RatingProps {
  voteAverage: number | null;
  voteCount: number | null;
}

/**
 * TMDB community rating. Renders nothing when nobody has voted — TMDB reports an
 * unrated title as 0.0 out of 0 votes, which would read as a terrible score.
 */
export default function Rating({ voteAverage, voteCount }: Readonly<RatingProps>) {
  if (!voteAverage || !voteCount) return null;

  return (
    <span
      className="flex items-center gap-1"
      title={`${voteCount.toLocaleString()} TMDB votes`}
    >
      <span aria-hidden className="text-yellow-400">
        ★
      </span>
      <span className="font-medium text-foreground">{voteAverage.toFixed(1)}</span>
      <span>/10</span>
    </span>
  );
}
