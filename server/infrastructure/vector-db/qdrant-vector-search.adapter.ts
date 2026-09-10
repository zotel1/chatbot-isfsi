import {
  QdrantClient,
} from '@qdrant/js-client-rest';

import {
  VectorSearchPort,
} from '../../application/ports/vector-search.port.js';

import {
  KnowledgeChunk,
  KnowledgeKind,
} from '../../domain/entities/knowledge-chunk.js';

export class QdrantVectorSearchAdapter
implements VectorSearchPort {

  private readonly client:
    QdrantClient;

  constructor(
    url: string,
    apiKey: string,

    private readonly collection:
      string
  ) {

    this.client =
      new QdrantClient({
        url,
        apiKey,
      });
  }

  async search(
    vector: number[],
    limit: number
  ): Promise<KnowledgeChunk[]> {

    const response =
      await this.client.query(
        this.collection,
        {
          query:
            vector,

          limit,

          with_payload:
            true,

          with_vector:
            false,
        }
      );

    return response.points.map(
      (point) => {

        const payload =
          point.payload ?? {};

        return {
          chunkId:
            String(
              payload['chunkId'] ??
              ''
            ),

          sourceId:
            String(
              payload['sourceId'] ??
              ''
            ),

          document:
            String(
              payload['document'] ??
              ''
            ),

          resolution:
            String(
              payload['resolution'] ??
              ''
            ),

          jurisdiction:
            String(
              payload['jurisdiction'] ??
              ''
            ),

          chapter:
            typeof payload['chapter'] ===
              'string'
              ? payload['chapter']
              : null,

          section:
            typeof payload['section'] ===
              'string'
              ? payload['section']
              : null,

          article:
            typeof payload['article'] ===
              'number'
              ? payload['article']
              : null,

          inciso:
            typeof payload['inciso'] ===
              'string'
              ? payload['inciso']
              : null,

          chunkIndex:
            typeof payload['chunkIndex'] ===
              'number'
              ? payload['chunkIndex']
              : 1,

          kind:
            (
              payload['kind'] ===
              'section-intro'
                ? 'section-intro'
                : 'article'
            ) as KnowledgeKind,

          text:
            String(
              payload['text'] ??
              ''
            ),

          type:
            'normativa',

          score:
            point.score,
        };
      }
    );
  }
}