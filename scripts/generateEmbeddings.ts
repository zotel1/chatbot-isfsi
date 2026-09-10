import fs from 'node:fs';
import path from 'node:path';

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

const INPUT_FILE = path.join(
  process.cwd(),
  'data',
  'processed',
  'ram_chunks.json'
);

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

/*
 * Flynn nos enseñó que enviar muchas
 * solicitudes seguidas puede provocar 429.
 *
 * Usaremos un segundo aproximadamente
 * entre embeddings.
 */
const DELAY_BETWEEN_REQUESTS_MS =
  1000;

/*
 * Los vectores se enviarán a Qdrant
 * en grupos de 10.
 */
const UPSERT_BATCH_SIZE =
  10;

/*
 * Reintentos máximos por embedding.
 */
const MAX_RETRIES =
  5;

/*
 * Espera inicial ante rate limit.
 */
const RETRY_DELAY_MS =
  30_000;

// =====================================================
// TIPOS
// =====================================================

type ChunkKind =
  | 'article'
  | 'section-intro';

interface RamChunk {
  id: string;

  sourceId: string;

  document: string;

  resolution: string;

  jurisdiction: string;

  chapter: string | null;

  section: string | null;

  article: number | null;

  inciso: string | null;

  chunkIndex: number;

  kind: ChunkKind;

  text: string;

  type: 'normativa';
}

interface RamData {
  metadata: {
    totalArticles: number;

    totalChunks: number;
  };

  chunks: RamChunk[];
}

interface QdrantPoint {
  id: number;

  vector: number[];

  payload: {
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

    kind: ChunkKind;

    text: string;

    type: 'normativa';
  };
}

// =====================================================
// VALIDAR VARIABLES DE ENTORNO
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

  if (
    !Number.isInteger(
      EMBEDDING_DIMENSIONS
    ) ||
    EMBEDDING_DIMENSIONS <= 0
  ) {
    throw new Error(
      '❌ EMBEDDING_DIMENSIONS no es válido.'
    );
  }
}

// =====================================================
// CLIENTES
// =====================================================

validateEnvironment();

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
// SLEEP
// =====================================================

function sleep(
  milliseconds: number
): Promise<void> {

  return new Promise(
    (resolve) =>
      setTimeout(
        resolve,
        milliseconds
      )
  );
}

// =====================================================
// CARGAR JSON
// =====================================================

function loadRamChunks(): RamData {

  if (
    !fs.existsSync(
      INPUT_FILE
    )
  ) {

    throw new Error(
      `❌ No existe el archivo:\n${INPUT_FILE}`
    );
  }

  const raw =
    fs.readFileSync(
      INPUT_FILE,
      'utf-8'
    );

  const data =
    JSON.parse(
      raw
    ) as RamData;

  if (
    !Array.isArray(
      data.chunks
    )
  ) {

    throw new Error(
      '❌ El JSON no contiene un array "chunks".'
    );
  }

  if (
    data.chunks.length === 0
  ) {

    throw new Error(
      '❌ No existen chunks para procesar.'
    );
  }

  return data;
}

// =====================================================
// CONSTRUIR TEXTO PARA EMBEDDING
// =====================================================

function buildEmbeddingText(
  chunk: RamChunk
): string {

  const context: string[] = [
    `Documento: ${chunk.document}`,
    `Resolución: ${chunk.resolution}`,
    `Jurisdicción: ${chunk.jurisdiction}`,
  ];

  if (
    chunk.chapter
  ) {

    context.push(
      `Capítulo: ${chunk.chapter}`
    );
  }

  if (
    chunk.section
  ) {

    context.push(
      `Sección: ${chunk.section}`
    );
  }

  if (
    chunk.article !== null
  ) {

    context.push(
      `Artículo: ${chunk.article}`
    );

  } else {

    context.push(
      'Contenido introductorio de sección'
    );
  }

  context.push(
    '',
    chunk.text
  );

  return context.join(
    '\n'
  );
}

// =====================================================
// GENERAR EMBEDDING
// =====================================================

async function generateEmbedding(
  text: string
): Promise<number[]> {

  let attempt =
    0;

  while (
    attempt <
    MAX_RETRIES
  ) {

    try {

      const response =
        await ai.models
          .embedContent({
            model:
              EMBEDDING_MODEL,

            contents:
              text,

            config: {
              outputDimensionality:
                EMBEDDING_DIMENSIONS,
            },
          });

      const embedding =
        response
          .embeddings?.[0]
          ?.values;

      if (
        !embedding
      ) {

        throw new Error(
          'Gemini no devolvió valores para el embedding.'
        );
      }

      if (
        embedding.length !==
        EMBEDDING_DIMENSIONS
      ) {

        throw new Error(
          `Embedding inesperado: ${embedding.length} dimensiones. Se esperaban ${EMBEDDING_DIMENSIONS}.`
        );
      }

      return embedding;

    } catch (
      error: unknown
    ) {

      attempt++;

      const message =
        error instanceof Error
          ? error.message
          : String(error);

      const isRateLimit =
        message.includes(
          '429'
        ) ||
        message
          .toLowerCase()
          .includes(
            'resource_exhausted'
          ) ||
        message
          .toLowerCase()
          .includes(
            'rate'
          );

      if (
        isRateLimit &&
        attempt <
        MAX_RETRIES
      ) {

        /*
         * Espera incremental:
         *
         * intento 1 → 30 s
         * intento 2 → 60 s
         * intento 3 → 90 s
         */
        const waitTime =
          RETRY_DELAY_MS *
          attempt;

        console.warn(
          `⚠️ Límite de Gemini. Reintentando en ${waitTime / 1000}s...`
        );

        await sleep(
          waitTime
        );

        continue;
      }

      throw error;
    }
  }

  throw new Error(
    '❌ Se agotaron los reintentos de Gemini.'
  );
}

// =====================================================
// VERIFICAR COLLECTION QDRANT
// =====================================================

async function validateQdrantCollection():
  Promise<void> {

  console.log(
    '🔎 Verificando collection de Qdrant...'
  );

  const collections =
    await qdrant
      .getCollections();

  const exists =
    collections
      .collections
      .some(
        (collection) =>
          collection.name ===
          COLLECTION_NAME
      );

  if (!exists) {

    throw new Error(
      `❌ No existe la collection "${COLLECTION_NAME}".`
    );
  }

  console.log(
    `✅ Collection encontrada: ${COLLECTION_NAME}`
  );
}

// =====================================================
// ENVIAR LOTE A QDRANT
// =====================================================

async function upsertBatch(
  points: QdrantPoint[]
): Promise<void> {

  if (
    points.length === 0
  ) {

    return;
  }

  await qdrant.upsert(
    COLLECTION_NAME,
    {
      wait:
        true,

      points,
    }
  );
}

// =====================================================
// PROCESO PRINCIPAL
// =====================================================

async function main():
  Promise<void> {

  console.log(
    '🚀 Generando embeddings de la RAM...\n'
  );

  // ---------------------------------------------------
  // 1. Verificar Qdrant
  // ---------------------------------------------------

  await validateQdrantCollection();

  // ---------------------------------------------------
  // 2. Leer JSON
  // ---------------------------------------------------

  const data =
    loadRamChunks();

  const chunks =
    data.chunks;

  console.log(
    `📚 Artículos en metadata: ${data.metadata.totalArticles}`
  );

  console.log(
    `🧩 Chunks a procesar: ${chunks.length}`
  );

  console.log(
    `🧠 Modelo: ${EMBEDDING_MODEL}`
  );

  console.log(
    `📐 Dimensiones: ${EMBEDDING_DIMENSIONS}`
  );

  console.log(
    `📦 Collection: ${COLLECTION_NAME}\n`
  );

  // ---------------------------------------------------
  // 3. Generar embeddings
  // ---------------------------------------------------

  let batch:
    QdrantPoint[] = [];

  let processed =
    0;

  for (
    let index = 0;
    index <
    chunks.length;
    index++
  ) {

    const chunk =
      chunks[index];

    const current =
      index + 1;

    console.log(
      `🧠 [${current}/${chunks.length}] ${chunk.id}`
    );

    if (
      chunk.article !== null
    ) {

      console.log(
        `   Artículo ${chunk.article}`
      );

    } else {

      console.log(
        `   Introducción: ${chunk.section ?? 'sin sección'}`
      );
    }

    const embeddingText =
      buildEmbeddingText(
        chunk
      );

    const vector =
      await generateEmbedding(
        embeddingText
      );

    /*
     * Usamos IDs numéricos simples en Qdrant.
     *
     * El identificador semántico real permanece
     * en payload.chunkId.
     */
    const point:
      QdrantPoint = {

      id:
        current,

      vector,

      payload: {

        chunkId:
          chunk.id,

        sourceId:
          chunk.sourceId,

        document:
          chunk.document,

        resolution:
          chunk.resolution,

        jurisdiction:
          chunk.jurisdiction,

        chapter:
          chunk.chapter,

        section:
          chunk.section,

        article:
          chunk.article,

        inciso:
          chunk.inciso,

        chunkIndex:
          chunk.chunkIndex,

        kind:
          chunk.kind,

        text:
          chunk.text,

        type:
          chunk.type,
      },
    };

    batch.push(
      point
    );

    processed++;

    // -------------------------------------------------
    // Enviar lote
    // -------------------------------------------------

    if (
      batch.length >=
        UPSERT_BATCH_SIZE ||
      current ===
        chunks.length
    ) {

      console.log(
        `   📤 Enviando lote de ${batch.length} punto(s) a Qdrant...`
      );

      await upsertBatch(
        batch
      );

      console.log(
        `   ✅ Lote guardado.`
      );

      batch = [];
    }

    // -------------------------------------------------
    // Rate limiting preventivo
    // -------------------------------------------------

    if (
      current <
      chunks.length
    ) {

      await sleep(
        DELAY_BETWEEN_REQUESTS_MS
      );
    }
  }

  // ---------------------------------------------------
  // FINAL
  // ---------------------------------------------------

  console.log(
    '\n========================================'
  );

  console.log(
    '🎉 PROCESO COMPLETADO'
  );

  console.log(
    `✅ Chunks procesados: ${processed}`
  );

  console.log(
    `✅ Collection: ${COLLECTION_NAME}`
  );

  console.log(
    `✅ Dimensiones: ${EMBEDDING_DIMENSIONS}`
  );

  console.log(
    '========================================'
  );
}

main()
  .catch(
    (
      error: unknown
    ) => {

      console.error(
        '\n🔥 Error generando embeddings:'
      );

      if (
        error instanceof
        Error
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