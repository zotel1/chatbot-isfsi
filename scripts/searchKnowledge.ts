import 'dotenv/config';

import {
  GoogleGenAI,
} from '@google/genai';

import {
  QdrantClient,
} from '@qdrant/js-client-rest';

// =====================================================
// CONFIGURACIÓN
// =====================================================

const GEMINI_API_KEY =
  process.env.GEMINI_API_KEY;

const QDRANT_URL =
  process.env.QDRANT_URL;

const QDRANT_API_KEY =
  process.env.QDRANT_API_KEY;

const COLLECTION_NAME =
  process.env.QDRANT_COLLECTION_NAME ??
  'isfd-knowledge-v1';

const EMBEDDING_MODEL =
  process.env.EMBEDDING_MODEL ??
  'gemini-embedding-2';

const EMBEDDING_DIMENSIONS =
  Number(
    process.env.EMBEDDING_DIMENSIONS ??
    '768'
  );

const TOP_K_RESULTS = 5;

// =====================================================
// VALIDACIONES
// =====================================================

function validateEnvironment(): void {

  if (!GEMINI_API_KEY) {
    throw new Error(
      '❌ Falta GEMINI_API_KEY en .env'
    );
  }

  if (!QDRANT_URL) {
    throw new Error(
      '❌ Falta QDRANT_URL en .env'
    );
  }

  if (!QDRANT_API_KEY) {
    throw new Error(
      '❌ Falta QDRANT_API_KEY en .env'
    );
  }
}

validateEnvironment();

// =====================================================
// CLIENTES
// =====================================================

const ai =
  new GoogleGenAI({
    apiKey:
      GEMINI_API_KEY!,
  });

const qdrant =
  new QdrantClient({
    url:
      QDRANT_URL!,

    apiKey:
      QDRANT_API_KEY!,
  });

// =====================================================
// GENERAR EMBEDDING DE CONSULTA
// =====================================================

async function generateQueryEmbedding(
  query: string
): Promise<number[]> {

  const response =
    await ai.models.embedContent({
      model:
        EMBEDDING_MODEL,

      contents:
        query,

      config: {
        outputDimensionality:
          EMBEDDING_DIMENSIONS,
      },
    });

  const embedding =
    response.embeddings?.[0]
      ?.values;

  if (!embedding) {

    throw new Error(
      '❌ Gemini no devolvió embedding para la consulta.'
    );
  }

  if (
    embedding.length !==
    EMBEDDING_DIMENSIONS
  ) {

    throw new Error(
      `❌ Se esperaban ${EMBEDDING_DIMENSIONS} dimensiones pero Gemini devolvió ${embedding.length}.`
    );
  }

  return embedding;
}

// =====================================================
// BUSCAR EN QDRANT
// =====================================================

async function searchKnowledge(
  query: string
): Promise<void> {

  console.log(
    '\n========================================'
  );

  console.log(
    `🔎 Consulta: ${query}`
  );

  console.log(
    '========================================\n'
  );

  // ---------------------------------------------------
  // 1. Convertir consulta en vector
  // ---------------------------------------------------

  const queryVector =
    await generateQueryEmbedding(
      query
    );

  // ---------------------------------------------------
  // 2. Consultar Qdrant
  // ---------------------------------------------------

  const response =
    await qdrant.query(
      COLLECTION_NAME,
      {
        query:
          queryVector,

        limit:
          TOP_K_RESULTS,

        with_payload:
          true,

        with_vector:
          false,
      }
    );

  /*
   * IMPORTANTE:
   *
   * query() devuelve:
   *
   * {
   *   points: [...]
   * }
   *
   * y no directamente un array.
   */
  const results =
    response.points;

  // ---------------------------------------------------
  // 3. Comprobar resultados
  // ---------------------------------------------------

  if (
    results.length === 0
  ) {

    console.log(
      '⚠️ Qdrant no devolvió resultados.'
    );

    return;
  }

  // ---------------------------------------------------
  // 4. Mostrar resultados
  // ---------------------------------------------------

  for (
    let index = 0;
    index < results.length;
    index++
  ) {

    const result =
      results[index];

    const payload =
      result.payload ?? {};

    console.log(
      `🥇 Resultado ${index + 1}`
    );

    console.log(
      `Score: ${result.score.toFixed(4)}`
    );

    console.log(
      `Point ID: ${result.id}`
    );

    console.log(
      `Chunk ID: ${payload['chunkId'] ?? '-'}`
    );

    console.log(
      `Tipo: ${payload['kind'] ?? '-'}`
    );

    console.log(
      `Documento: ${payload['document'] ?? '-'}`
    );

    console.log(
      `Resolución: ${payload['resolution'] ?? '-'}`
    );

    console.log(
      `Capítulo: ${payload['chapter'] ?? '-'}`
    );

    console.log(
      `Sección: ${payload['section'] ?? '-'}`
    );

    console.log(
      `Artículo: ${payload['article'] ?? '-'}`
    );

    console.log(
      '\nTexto:'
    );

    console.log(
      payload['text'] ?? '-'
    );

    console.log(
      '\n----------------------------------------\n'
    );
  }
}

// =====================================================
// PROCESO PRINCIPAL
// =====================================================

async function main(): Promise<void> {

  const query =
    process.argv
      .slice(2)
      .join(' ')
      .trim();

  if (!query) {

    console.log(
      '❌ Tenés que escribir una consulta.'
    );

    console.log(
      '\nEjemplo:'
    );

    console.log(
      'npm run search:knowledge -- "¿Qué necesito para mantener la regularidad?"'
    );

    return;
  }

  await searchKnowledge(
    query
  );
}

main()
  .catch(
    (
      error: unknown
    ) => {

      console.error(
        '\n🔥 Error realizando búsqueda:'
      );

      if (
        error instanceof Error
      ) {

        console.error(
          error.message
        );

      } else {

        console.error(
          error
        );
      }

      process.exitCode =
        1;
    }
  );