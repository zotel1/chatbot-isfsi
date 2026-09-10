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

const client =
  new QdrantClient({
    url:
      QDRANT_URL,

    apiKey:
      QDRANT_API_KEY,
  });

async function main(): Promise<void> {

  console.log(
    '🔌 Probando conexión con Qdrant...'
  );

  const collections =
    await client
      .getCollections();

  console.log(
    '✅ Conexión correcta.'
  );

  console.log(
    '\n📦 Collections disponibles:'
  );

  for (
    const collection
    of collections.collections
  ) {

    console.log(
      `- ${collection.name}`
    );
  }

  const exists =
    collections.collections
      .some(
        (collection) =>
          collection.name ===
          COLLECTION_NAME
      );

  if (exists) {

    console.log(
      `\n✅ Collection encontrada: ${COLLECTION_NAME}`
    );

  } else {

    console.log(
      `\n⚠️ No existe todavía: ${COLLECTION_NAME}`
    );
  }
}

main()
  .catch(
    (error) => {

      console.error(
        '\n🔥 Error conectando a Qdrant:'
      );

      console.error(
        error
      );

      process.exitCode =
        1;
    }
  );