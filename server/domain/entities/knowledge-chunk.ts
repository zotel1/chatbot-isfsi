export type KnowledgeKind =
  | 'article'
  | 'section-intro';

export interface KnowledgeChunk {
  chunkId: string;

  sourceId: string;

  document: string;

  resolution: string;

  jurisdiction: string;

  chapter: string | null;

  section: string | null;

  article: number | null;

  inciso: string | null;

  chunkIndex: number;

  kind: KnowledgeKind;

  text: string;

  type: 'normativa';

  score: number;
}