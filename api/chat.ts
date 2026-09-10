import type {
  VercelRequest,
  VercelResponse,
} from '@vercel/node';

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
// HANDLER
// =====================================================

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {

  if (
    req.method !==
    'POST'
  ) {

    res
      .status(405)
      .json({
        error:
          'Método no permitido.',
      });

    return;
  }

  try {

    const question =
      typeof req.body
        ?.question ===
        'string'
        ? req.body.question.trim()
        : '';

    if (!question) {

      res
        .status(400)
        .json({
          error:
            'La consulta no puede estar vacía.',
        });

      return;
    }

    const answer =
      await askQuestion.execute(
        question
      );

    res
      .status(200)
      .json(
        answer
      );

  } catch (
    error: unknown
  ) {

    console.error(
      'Error en /api/chat:',
      error
    );

    res
      .status(500)
      .json({
        error:
          'Ocurrió un error al procesar la consulta.',
      });
  }
}