import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

import 'dotenv/config';

import { GoogleGenAI } from '@google/genai';
import { QdrantClient } from '@qdrant/js-client-rest';

// =====================================================
// CONFIGURACIÓN
// =====================================================

const INPUT_FILES = [
  'ram_chunks.json',
  'diseno_curricular_software_chunks.json',
  'regimen_correlatividad_software_chunks.json',
];

const COLLECTION_NAME =
  process.env.QDRANT_COLLECTION_NAME ??
  'isfd-knowledge-v2';

const EMBEDDING_MODEL =
  process.env.EMBEDDING_MODEL ??
  'gemini-embedding-2';

const EMBEDDING_DIMENSIONS =
  Number(
    process.env.EMBEDDING_DIMENSIONS ??
    '768'
  );

const UPSERT_BATCH_SIZE = 10;
const DELAY_MS = 1000;
const MAX_RETRIES = 5;

const DRY_RUN =
  process.argv.includes('--dry-run');

// =====================================================
// TIPOS
// =====================================================

type ChunkKind =
  | 'article'
  | 'section-intro'
  | 'section'
  | 'correlativity';

interface KnowledgeChunk {
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

interface KnowledgeFile {
  metadata: {
    totalChunks: number;
    [key: string]: unknown;
  };

  chunks: KnowledgeChunk[];
}

// =====================================================
// UTILIDADES
// =====================================================

function sleep(ms: number): Promise<void> {
  return new Promise(
    (resolve) =>
      setTimeout(resolve, ms)
  );
}

function isValidKind(
  value: unknown
): value is ChunkKind {
  return (
    value === 'article' ||
    value === 'section-intro' ||
    value === 'section' ||
    value === 'correlativity'
  );
}

// Genera un UUID estable a partir del ID semántico.
// Si volvemos a ejecutar la carga, el mismo chunk
// obtiene exactamente el mismo ID en Qdrant.
function deterministicUuid(
  value: string
): string {

  const hash =
    createHash('sha256')
      .update(value)
      .digest('hex')
      .slice(0, 32)
      .split('');

  // Versión 5
  hash[12] = '5';

  // Variante UUID estándar
  hash[16] =
    (
      (parseInt(hash[16], 16) & 0x3) |
      0x8
    ).toString(16);

  const hex =
    hash.join('');

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

// =====================================================
// CARGAR LOS TRES JSON
// =====================================================

function loadKnowledge():
  KnowledgeChunk[] {

  const allChunks:
    KnowledgeChunk[] = [];

  for (
    const fileName
    of INPUT_FILES
  ) {

    const filePath =
      path.join(
        process.cwd(),
        'data',
        'processed',
        fileName
      );

    if (
      !fs.existsSync(filePath)
    ) {
      throw new Error(
        `No existe: ${filePath}`
      );
    }

    const raw =
      fs.readFileSync(
        filePath,
        'utf-8'
      );

   
       const data = JSON.parse(raw) as KnowledgeFile;

    if (
      !Array.isArray(
        data.chunks
      )
    ) {
      throw new Error(
        `${fileName} no contiene un array "chunks".`
      );
    }

    console.log(
      `📄 ${fileName}: ${data.chunks.length} chunks`
    );

    allChunks.push(
      ...data.chunks
    );
  }

  return allChunks;
}

// =====================================================
// VALIDAR CHUNKS
// =====================================================

function validateChunks(
  chunks: KnowledgeChunk[]
): void {

  const ids =
    new Set<string>();

  for (
    const chunk
    of chunks
  ) {

    if (!chunk.id) {
      throw new Error(
        'Existe un chunk sin ID.'
      );
    }

    if (
      ids.has(chunk.id)
    ) {
      throw new Error(
        `ID duplicado: ${chunk.id}`
      );
    }

    ids.add(
      chunk.id
    );

    if (
      !isValidKind(
        chunk.kind
      )
    ) {
      throw new Error(
        `Kind no válido en ${chunk.id}: ${chunk.kind}`
      );
    }

    if (
      !chunk.text ||
      !chunk.text.trim()
    ) {
      throw new Error(
        `Chunk sin texto: ${chunk.id}`
      );
    }
  }
}

// =====================================================
// TEXTO QUE SE ENVÍA A GEMINI
// =====================================================

function buildEmbeddingText(
  chunk: KnowledgeChunk
): string {

  const context: string[] = [
    `Documento: ${chunk.document}`,
    `Resolución: ${chunk.resolution}`,
    `Jurisdicción: ${chunk.jurisdiction}`,
  ];

  if (chunk.chapter) {
    context.push(
      `Capítulo: ${chunk.chapter}`
    );
  }

  if (chunk.section) {
    context.push(
      `Sección: ${chunk.section}`
    );
  }

  switch (chunk.kind) {

    case 'article':

      context.push(
        chunk.article !== null
          ? `Artículo: ${chunk.article}`
          : 'Tipo de contenido: Artículo'
      );

      break;

    case 'section-intro':

      context.push(
        'Tipo de contenido: Introducción de sección'
      );

      break;

    case 'section':

      context.push(
        'Tipo de contenido: Sección'
      );

      break;

    case 'correlativity':

      context.push(
        'Tipo de contenido: Correlatividad académica'
      );

      break;
  }

  context.push(
    '',
    chunk.text
  );

  return context.join('\n');
}

// =====================================================
// EMBEDDING
// =====================================================

async function generateEmbedding(
  ai: GoogleGenAI,
  text: string
): Promise<number[]> {

  for (
    let attempt = 1;
    attempt <= MAX_RETRIES;
    attempt++
  ) {

    try {

      const response =
        await ai.models.embedContent({
          model:
            EMBEDDING_MODEL,

          contents:
            text,

          config: {
            outputDimensionality:
              EMBEDDING_DIMENSIONS,
          },
        });

      const vector =
        response
          .embeddings?.[0]
          ?.values;

      if (!vector) {
        throw new Error(
          'Gemini no devolvió embedding.'
        );
      }

      if (
        vector.length !==
        EMBEDDING_DIMENSIONS
      ) {
        throw new Error(
          `Dimensión inesperada: ${vector.length}`
        );
      }

      return vector;

    } catch (error) {

      if (
        attempt ===
        MAX_RETRIES
      ) {
        throw error;
      }

      console.warn(
        `⚠️ Reintento ${attempt}/${MAX_RETRIES}`
      );

      await sleep(
        attempt * 30_000
      );
    }
  }

  throw new Error(
    'No se pudo generar el embedding.'
  );
}

// =====================================================
// PROCESO PRINCIPAL
// =====================================================

async function main():
  Promise<void> {

  console.log(
    '\n🚀 Preparando conocimiento...\n'
  );

  const chunks =
    loadKnowledge();

  validateChunks(
    chunks
  );

  console.log(
    `\n✅ JSON válidos`
  );

  console.log(
    `🧩 Total de chunks: ${chunks.length}`
  );

  // ---------------------------------------------
  // PRUEBA EN SECO
  // ---------------------------------------------

  if (DRY_RUN) {

    console.log(
      '\n🧪 DRY RUN'
    );

    console.log(
      'No se generaron embeddings.'
    );

    console.log(
      'No se escribió nada en Qdrant.'
    );

    return;
  }

  // ---------------------------------------------
  // VARIABLES REALES
  // ---------------------------------------------

  const GEMINI_API_KEY =
    process.env.GEMINI_API_KEY;

  const QDRANT_URL =
    process.env.QDRANT_URL;

  const QDRANT_API_KEY =
    process.env.QDRANT_API_KEY;

  if (!GEMINI_API_KEY) {
    throw new Error(
      'Falta GEMINI_API_KEY.'
    );
  }

  if (!QDRANT_URL) {
    throw new Error(
      'Falta QDRANT_URL.'
    );
  }

  if (!QDRANT_API_KEY) {
    throw new Error(
      'Falta QDRANT_API_KEY.'
    );
  }

  const ai =
    new GoogleGenAI({
      apiKey:
        GEMINI_API_KEY,
    });

  const qdrant =
    new QdrantClient({
      url:
        QDRANT_URL,

      apiKey:
        QDRANT_API_KEY,
    });

  const collections =
    await qdrant
      .getCollections();

  const exists =
    collections.collections
      .some(
        (collection) =>
          collection.name ===
          COLLECTION_NAME
      );

  if (!exists) {
    throw new Error(
      `No existe la colección ${COLLECTION_NAME}.`
    );
  }

  console.log(
    `📦 Colección: ${COLLECTION_NAME}`
  );

  console.log(
    `🧠 Modelo: ${EMBEDDING_MODEL}`
  );

  console.log(
    `📐 Dimensiones: ${EMBEDDING_DIMENSIONS}\n`
  );

  let batch:
    Array<{
      id: string;
      vector: number[];
      payload: Record<
        string,
        unknown
      >;
    }> = [];

  for (
    let index = 0;
    index < chunks.length;
    index++
  ) {

    const chunk =
      chunks[index];

    console.log(
      `[${index + 1}/${chunks.length}] ${chunk.id}`
    );

    const embeddingText =
      buildEmbeddingText(
        chunk
      );

    const vector =
      await generateEmbedding(
        ai,
        embeddingText
      );

    batch.push({
      id:
        deterministicUuid(
          chunk.id
        ),

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
    });

    if (
      batch.length >=
        UPSERT_BATCH_SIZE ||
      index ===
        chunks.length - 1
    ) {

      await qdrant.upsert(
        COLLECTION_NAME,
        {
          wait: true,
          points: batch,
        }
      );

      console.log(
        `   ✅ ${batch.length} puntos guardados`
      );

      batch = [];
    }

    if (
      index <
      chunks.length - 1
    ) {
      await sleep(
        DELAY_MS
      );
    }
  }

  console.log(
    '\n🎉 Carga finalizada.'
  );

  console.log(
    `✅ ${chunks.length} chunks procesados.`
  );

  console.log(
    `✅ Colección: ${COLLECTION_NAME}\n`
  );
}

main()
  .catch(
    (error: unknown) => {

      console.error(
        '\n🔥 Error:'
      );

      console.error(
        error instanceof Error
          ? error.message
          : error
      );

      process.exitCode = 1;
    }
  );

