import {
  KnowledgeChunk,
} from '../../domain/entities/knowledge-chunk.js';

export interface VectorSearchPort {

  search(
    vector: number[],
    limit: number
  ): Promise<KnowledgeChunk[]>;
}