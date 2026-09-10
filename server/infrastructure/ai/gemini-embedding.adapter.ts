import {
  GoogleGenAI,
} from '@google/genai';

import {
  EmbeddingGeneratorPort,
} from '../../application/ports/embedding-generator.port.js';

export class GeminiEmbeddingAdapter
implements EmbeddingGeneratorPort {

  private readonly ai:
    GoogleGenAI;

  constructor(
    apiKey: string,

    private readonly model:
      string,

    private readonly dimensions:
      number
  ) {

    this.ai =
      new GoogleGenAI({
        apiKey,
      });
  }

  async generate(
    text: string
  ): Promise<number[]> {

    const response =
      await this.ai.models
        .embedContent({
          model:
            this.model,

          contents:
            text,

          config: {
            outputDimensionality:
              this.dimensions,
          },
        });

    const embedding =
      response
        .embeddings?.[0]
        ?.values;

    if (!embedding) {

      throw new Error(
        'Gemini no devolvió un embedding.'
      );
    }

    if (
      embedding.length !==
      this.dimensions
    ) {

      throw new Error(
        `Embedding incorrecto: ${embedding.length} dimensiones.`
      );
    }

    return embedding;
  }
}