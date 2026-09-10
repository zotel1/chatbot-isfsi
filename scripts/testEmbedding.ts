import 'dotenv/config';

import { GoogleGenAI } from '@google/genai';

const GEMINI_API_KEY =
  process.env.GEMINI_API_KEY;

const EMBEDDING_MODEL =
  process.env.EMBEDDING_MODEL ??
  'gemini-embedding-2';

const EMBEDDING_DIMENSIONS =
  Number(
    process.env.EMBEDDING_DIMENSIONS ??
    '768'
  );

if (!GEMINI_API_KEY) {
  throw new Error(
    '❌ Falta GEMINI_API_KEY en .env'
  );
}

const ai =
  new GoogleGenAI({
    apiKey:
      GEMINI_API_KEY,
  });

async function main(): Promise<void> {

  console.log(
    '🧠 Probando Gemini Embedding...'
  );

  const response =
    await ai.models.embedContent({
      model:
        EMBEDDING_MODEL,

      contents:
        '¿Qué necesito para mantener la regularidad como estudiante?',

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
      '❌ Gemini no devolvió un embedding.'
    );
  }

  console.log(
    `✅ Modelo: ${EMBEDDING_MODEL}`
  );

  console.log(
    `✅ Dimensiones: ${embedding.length}`
  );

  console.log(
    '✅ Primeros valores:'
  );

  console.log(
    embedding.slice(
      0,
      5
    )
  );
}

main()
  .catch(
    (error) => {

      console.error(
        '\n🔥 Error:'
      );

      console.error(
        error
      );

      process.exitCode =
        1;
    }
  );