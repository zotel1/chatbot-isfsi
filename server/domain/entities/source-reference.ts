export interface SourceReference {
  chunkId: string;

  document: string;

  resolution: string;

  chapter: string | null;

  section: string | null;

  article: number | null;
}