export interface EmbeddingGeneratorPort {

  generate(
    text: string
  ): Promise<number[]>;
}