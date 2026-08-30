/**
 * Error hierarchy for the Albion Maps importer. The sync treats every one of
 * these as fatal: a failed fetch/parse must never produce a partial dataset.
 */
export class AlbionMapsError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'AlbionMapsError';
  }
}

/** The site was unreachable or answered non-2xx. */
export class AlbionMapsFetchError extends AlbionMapsError {}

/** The site's HTML was not parseable (payload truncated, JSON invalid, ...). */
export class AlbionMapsParseError extends AlbionMapsError {}

/** Two distinct site cards normalized to the same zone name. */
export class AlbionMapsAmbiguousMatchError extends AlbionMapsError {}
