import 'dotenv/config';

function requireEnvironment(
  name: string
): string {

  const value =
    process.env[name];

  if (!value) {

    throw new Error(
      `Falta la variable de entorno ${name}.`
    );
  }

  return value;
}

export const env = {

  geminiApiKey:
    requireEnvironment(
      'GEMINI_API_KEY'
    ),

  qdrantUrl:
    requireEnvironment(
      'QDRANT_URL'
    ),

  qdrantApiKey:
    requireEnvironment(
      'QDRANT_API_KEY'
    ),

  collectionName:
    process.env
      .QDRANT_COLLECTION_NAME ??
    'isfd-knowledge-v1',

  embeddingModel:
    process.env
      .EMBEDDING_MODEL ??
    'gemini-embedding-2',

  embeddingDimensions:
    Number(
      process.env
        .EMBEDDING_DIMENSIONS ??
      '768'
    ),

  chatModel:
    process.env
      .CHAT_MODEL ??
    'gemini-3.6-flash',

  topK:
    Number(
      process.env
        .TOP_K_RESULTS ??
      '5'
    ),
};