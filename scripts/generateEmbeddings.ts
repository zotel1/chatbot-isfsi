import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

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

const DELAY_BETWEEN_REQUESTS_MS =
  1000;

const UPSERT_BATCH_SIZE =
  10;

const MAX_RETRIES =
  5;

const RETRY_DELAY_MS =
  30_000;


// =====================================================
// TIPOS
// =====================================================

interface KnowledgeChunk {

  id: string;

  sourceId: string;

  document: string;

  resolution: string;

  jurisdiction: string;

  chapter?: string | null;

  section?: string | null;

  article?: number | null;

  inciso?: string | null;

  chunkIndex?: number;

  kind?: string;

  text: string;

  type?: string;

  [key: string]: unknown;
}


interface KnowledgeData {

  metadata?: {
    totalChunks?: number;

    [key: string]: unknown;
  };

  chunks: KnowledgeChunk[];
}


// =====================================================
// VALIDAR VARIABLES DE ENTORNO
// =====================================================

function validateEnvironment(): void {

  if (!GEMINI_API_KEY) {

    throw new Error(
      '❌ Falta GEMINI_API_KEY.'
    );
  }

  if (!QDRANT_URL) {

    throw new Error(
      '❌ Falta QDRANT_URL.'
    );
  }

  if (!QDRANT_API_KEY) {

    throw new Error(
      '❌ Falta QDRANT_API_KEY.'
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
// ESPERA
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
// CREAR ID ÚNICO Y ESTABLE PARA QDRANT
// =====================================================

function createStableUuid(
  value: string
): string {

  const hash =
    crypto
      .createHash('sha256')
      .update(value)
      .digest();

  const bytes =
    Buffer.from(
      hash.subarray(
        0,
        16
      )
    );

  /*
   * Convertimos los bytes en un UUID válido.
   */

  bytes[6] =
    (bytes[6] & 0x0f) |
    0x50;

  bytes[8] =
    (bytes[8] & 0x3f) |
    0x80;

  const hex =
    bytes.toString(
      'hex'
    );

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}


// =====================================================
// CARGAR JSON
// =====================================================

function loadKnowledgeFile(
  filePath: string
): KnowledgeData {

  if (
    !fs.existsSync(
      filePath
    )
  ) {

    throw new Error(
      `❌ No existe el archivo:\n${filePath}`
    );
  }

  const raw =
    fs.readFileSync(
      filePath,
      'utf-8'
    );

  const data =
    JSON.parse(
      raw
    ) as KnowledgeData;

  if (
    !Array.isArray(
      data.chunks
    )
  ) {

    throw new Error(
      `❌ El archivo ${filePath} no contiene un array "chunks".`
    );
  }

  if (
    data.chunks.length === 0
  ) {

    throw new Error(
      `❌ El archivo ${filePath} no contiene chunks.`
    );
  }

  return data;
}


// =====================================================
// CONSTRUIR TEXTO PARA EL EMBEDDING
// =====================================================

function buildEmbeddingText(
  chunk: KnowledgeChunk
): string {

  const context:
    string[] = [];

  context.push(
    `Documento: ${chunk.document}`
  );

  context.push(
    `Resolución: ${chunk.resolution}`
  );

  context.push(
    `Jurisdicción: ${chunk.jurisdiction}`
  );


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
    chunk.article !== null &&
    chunk.article !== undefined
  ) {

    context.push(
      `Artículo: ${chunk.article}`
    );
  }


  if (
    chunk.inciso
  ) {

    context.push(
      `Inciso: ${chunk.inciso}`
    );
  }


  if (
    chunk.kind
  ) {

    context.push(
      `Tipo de contenido: ${chunk.kind}`
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
          `Embedding inesperado: ${embedding.length} dimensiones.`
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
// VERIFICAR COLLECTION
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


  if (
    !exists
  ) {

    throw new Error(
      `❌ No existe la collection "${COLLECTION_NAME}".`
    );
  }


  console.log(
    `✅ Collection encontrada: ${COLLECTION_NAME}`
  );
}


// =====================================================
// PROCESAR UN ARCHIVO JSON
// =====================================================

async function processFile(
  filePath: string
): Promise<void> {

  console.log(
    '\n========================================'
  );

  console.log(
    `📄 Archivo: ${path.basename(filePath)}`
  );


  const data =
    loadKnowledgeFile(
      filePath
    );


  const chunks =
    data.chunks;


  console.log(
    `🧩 Chunks a procesar: ${chunks.length}`
  );

  console.log(
    `🧠 Modelo: ${EMBEDDING_MODEL}`
  );

  console.log(
    `📐 Dimensiones: ${EMBEDDING_DIMENSIONS}`
  );


  let batch:
    any[] = [];


  for (
    let index = 0;
    index <
    chunks.length;
    index++
  ) {

    const chunk =
      chunks[index];


    console.log(
      `\n🧠 [${index + 1}/${chunks.length}] ${chunk.id}`
    );


    console.log(
      `   Documento: ${chunk.document}`
    );


    if (
      chunk.section
    ) {

      console.log(
        `   Sección: ${chunk.section}`
      );
    }


    if (
      chunk.kind
    ) {

      console.log(
        `   Tipo: ${chunk.kind}`
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
     * El ID se genera usando sourceId + id.
     *
     * Esto evita que:
     *
     * RAM → punto 1
     * Diseño → punto 1
     *
     * terminen sobrescribiéndose.
     */

    const pointId =
      createStableUuid(
        `${chunk.sourceId}:${chunk.id}`
      );


    batch.push({

      id:
        pointId,

      vector,

      payload: {

        ...chunk,

        chunkId:
          chunk.id,

        type:
          chunk.type ??
          'normativa',
      },
    });


    if (
      batch.length >=
        UPSERT_BATCH_SIZE ||

      index ===
        chunks.length - 1
    ) {

      console.log(
        `   📤 Enviando lote de ${batch.length} punto(s) a Qdrant...`
      );


      await qdrant.upsert(
        COLLECTION_NAME,
        {

          wait:
            true,

          points:
            batch,
        }
      );


      console.log(
        '   ✅ Lote guardado.'
      );


      batch = [];
    }


    if (
      index <
      chunks.length - 1
    ) {

      await sleep(
        DELAY_BETWEEN_REQUESTS_MS
      );
    }
  }


  console.log(
    `\n✅ Archivo completado: ${path.basename(filePath)}`
  );
}


// =====================================================
// PROCESO PRINCIPAL
// =====================================================

async function main():
  Promise<void> {

  console.log(
    '\n🚀 CARGA DE CONOCIMIENTO A QDRANT\n'
  );


  await validateQdrantCollection();


  /*
   * Todo lo escrito después de:
   *
   * npm run generate:embeddings --
   *
   * llegará aquí.
   */

  const argumentsFromTerminal =
    process.argv.slice(2);


  if (
    argumentsFromTerminal.length ===
    0
  ) {

    throw new Error(
      [
        '❌ Debés indicar al menos un archivo JSON.',
        '',
        'Ejemplo:',
        '',
        'npm run generate:embeddings -- ".\\data\\processed\\regimen_correlatividad_software_chunks.json"',
      ].join('\n')
    );
  }


  for (
    const argument
    of argumentsFromTerminal
  ) {

    const absolutePath =
      path.resolve(
        process.cwd(),
        argument
      );


    await processFile(
      absolutePath
    );
  }


  console.log(
    '\n========================================'
  );

  console.log(
    '🎉 IMPORTACIÓN COMPLETADA'
  );

  console.log(
    `✅ Collection: ${COLLECTION_NAME}`
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