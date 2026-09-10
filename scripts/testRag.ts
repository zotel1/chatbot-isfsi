import 'dotenv/config';

import {
  AskInstitutionalQuestionUseCase,
} from '../server/application/use-cases/ask-institutional-question.use-case.js';

import {
  GeminiEmbeddingAdapter,
} from '../server/infrastructure/ai/gemini-embedding.adapter.js';

import {
  GeminiChatAdapter,
} from '../server/infrastructure/ai/gemini-chat.adapter.js';

import {
  QdrantVectorSearchAdapter,
} from '../server/infrastructure/vector-db/qdrant-vector-search.adapter.js';

import {
  env,
} from '../server/infrastructure/config/env.js';

// =====================================================
// DEPENDENCIAS
// =====================================================

const embeddingGenerator =
  new GeminiEmbeddingAdapter(
    env.geminiApiKey,
    env.embeddingModel,
    env.embeddingDimensions
  );

const vectorSearch =
  new QdrantVectorSearchAdapter(
    env.qdrantUrl,
    env.qdrantApiKey,
    env.collectionName
  );

const chatModel =
  new GeminiChatAdapter(
    env.geminiApiKey,
    env.chatModel
  );

const askQuestion =
  new AskInstitutionalQuestionUseCase(
    embeddingGenerator,
    vectorSearch,
    chatModel
  );

// =====================================================
// MAIN
// =====================================================

async function main():
  Promise<void> {

  const question =
    process.argv
      .slice(2)
      .join(' ')
      .trim();

  if (!question) {

    console.log(
      '❌ Escribí una pregunta.'
    );

    console.log(
      '\nEjemplo:'
    );

    console.log(
      'npm run test:rag -- "¿Qué tengo que aprobar para mantener la regularidad?"'
    );

    return;
  }

  console.log(
    '\n🤖 Consultando RAG...\n'
  );

  console.log(
    `❓ ${question}\n`
  );

  const answer =
    await askQuestion
      .execute(
        question
      );

  console.log(
    '💬 RESPUESTA:\n'
  );

  console.log(
    answer.reply
  );

  console.log(
    '\n📚 FUENTES:\n'
  );

  for (
    const source
    of answer.sources
  ) {

    const article =
      source.article !== null
        ? `Artículo ${source.article}`
        : 'Introducción de sección';

    console.log(
      `- ${source.document} | ${source.resolution} | ${article}`
    );
  }
}

main()
  .catch(
    (
      error: unknown
    ) => {

      console.error(
        '\n🔥 Error en RAG:'
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