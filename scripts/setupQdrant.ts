import 'dotenv/config';

import {
  QdrantClient,
} from '@qdrant/js-client-rest';

const QDRANT_URL =
  process.env.QDRANT_URL;

const QDRANT_API_KEY =
  process.env.QDRANT_API_KEY;

const COLLECTION_NAME =
  process.env.QDRANT_COLLECTION_NAME ??
  'isfd-knowledge-v1';

const EMBEDDING_DIMENSIONS =
  Number(
    process.env.EMBEDDING_DIMENSIONS ??
    '768'
  );

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

const client =
  new QdrantClient({
    url:
      QDRANT_URL,

    apiKey:
      QDRANT_API_KEY,
  });

async function main(): Promise<void> {

  console.log(
    '🚀 Preparando Qdrant...'
  );

  const collections =
    await client
      .getCollections();

  const exists =
    collections.collections
      .some(
        (collection) =>
          collection.name ===
          COLLECTION_NAME
      );

  if (exists) {

    console.log(
      `✅ La collection "${COLLECTION_NAME}" ya existe.`
    );

    return;
  }

  console.log(
    `📦 Creando "${COLLECTION_NAME}"...`
  );

  await client
    .createCollection(
      COLLECTION_NAME,
      {
        vectors: {
          size:
            EMBEDDING_DIMENSIONS,

          distance:
            'Cosine',
        },
      }
    );

  console.log(
    '✅ Collection creada.'
  );

  console.log(
    `📐 Dimensiones: ${EMBEDDING_DIMENSIONS}`
  );

  console.log(
    '📏 Distancia: Cosine'
  );
}

main()
  .catch(
    (error) => {

      console.error(
        '\n🔥 Error preparando Qdrant:'
      );

      console.error(
        error
      );

      process.exitCode =
        1;
    }
  );