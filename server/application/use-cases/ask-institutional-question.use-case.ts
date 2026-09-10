import {
  ChatAnswer,
} from '../../domain/entities/chat-answer.js';

import {
  KnowledgeChunk,
} from '../../domain/entities/knowledge-chunk.js';

import {
  SourceReference,
} from '../../domain/entities/source-reference.js';

import {
  EmbeddingGeneratorPort,
} from '../ports/embedding-generator.port.js';

import {
  VectorSearchPort,
} from '../ports/vector-search.port.js';

import {
  ChatModelPort,
} from '../ports/chat-model.port.js';

// =====================================================
// CONFIGURACIÓN
// =====================================================

const DEFAULT_TOP_K =
  5;

// =====================================================
// CASO DE USO
// =====================================================

export class AskInstitutionalQuestionUseCase {

  constructor(
    private readonly embeddingGenerator:
      EmbeddingGeneratorPort,

    private readonly vectorSearch:
      VectorSearchPort,

    private readonly chatModel:
      ChatModelPort
  ) {}

  async execute(
    question: string
  ): Promise<ChatAnswer> {

    const cleanQuestion =
      question.trim();

    if (!cleanQuestion) {

      throw new Error(
        'La consulta no puede estar vacía.'
      );
    }

    // -------------------------------------------------
    // 1. Embedding de la pregunta
    // -------------------------------------------------

    const queryVector =
      await this.embeddingGenerator
        .generate(
          cleanQuestion
        );

    // -------------------------------------------------
    // 2. Recuperación
    // -------------------------------------------------

    const chunks =
      await this.vectorSearch
        .search(
          queryVector,
          DEFAULT_TOP_K
        );

    // -------------------------------------------------
    // 3. Sin contexto
    // -------------------------------------------------

    if (
      chunks.length === 0
    ) {

      return {
        reply:
          'No encontré información suficiente en las fuentes institucionales disponibles para responder esa consulta.',

        sources: [],
      };
    }

    // -------------------------------------------------
    // 4. Construir prompt
    // -------------------------------------------------

    const prompt =
      this.buildPrompt(
        cleanQuestion,
        chunks
      );

    // -------------------------------------------------
    // 5. Gemini
    // -------------------------------------------------

    const reply =
      await this.chatModel
        .generate(
          prompt
        );

    // -------------------------------------------------
    // 6. Fuentes
    // -------------------------------------------------

    const sources =
      this.buildSources(
        chunks
      );

    return {
      reply,
      sources,
    };
  }

  // ===================================================
  // CONSTRUIR PROMPT
  // ===================================================

  private buildPrompt(
    question: string,
    chunks: KnowledgeChunk[]
  ): string {

    const context =
      chunks
        .map(
          (
            chunk,
            index
          ) => {

            const source =
              this.formatSource(
                chunk
              );

            return [
              `[FUENTE ${index + 1}]`,
              source,
              chunk.text,
            ].join(
              '\n'
            );
          }
        )
        .join(
          '\n\n'
        );

    return `
Sos un asistente institucional para estudiantes de un Instituto Superior de la Provincia de Corrientes.

Tu tarea es orientar consultas utilizando ÚNICAMENTE la información proporcionada en las fuentes institucionales recuperadas.

REGLAS OBLIGATORIAS:

1. No inventes normas, fechas, porcentajes, requisitos, trámites ni excepciones.

2. No utilices conocimiento externo para completar información faltante.

3. Diferenciá cuando una regla depende de una condición específica.

4. Si las fuentes no contienen información suficiente para responder, indicá claramente que no contás con información suficiente en las fuentes disponibles.

5. Si la consulta depende de una situación académica personal que no puede resolverse únicamente con la normativa recuperada, orientá al estudiante a consultar con la autoridad o área institucional correspondiente.

6. Respondé en español claro y comprensible.

7. Evitá lenguaje jurídico innecesariamente complejo, pero no cambies el significado de la normativa.

8. No afirmes que una decisión institucional ya fue tomada si las fuentes no lo indican.

9. Cuando corresponda, mencioná el número de artículo que sustenta la respuesta.

10. No inventes artículos ni referencias.

PREGUNTA DEL ESTUDIANTE:

${question}

FUENTES RECUPERADAS:

${context}

RESPUESTA:
`.trim();
  }

  // ===================================================
  // FORMATEAR FUENTE PARA GEMINI
  // ===================================================

  private formatSource(
    chunk: KnowledgeChunk
  ): string {

    const parts: string[] = [
      chunk.document,
      chunk.resolution,
    ];

    if (
      chunk.section
    ) {

      parts.push(
        `Sección: ${chunk.section}`
      );
    }

    if (
      chunk.article !== null
    ) {

      parts.push(
        `Artículo ${chunk.article}`
      );

    } else {

      parts.push(
        'Introducción de sección'
      );
    }

    return parts.join(
      ' | '
    );
  }

  // ===================================================
  // CONSTRUIR FUENTES PARA FRONTEND
  // ===================================================

  private buildSources(
    chunks: KnowledgeChunk[]
  ): SourceReference[] {

    const seen =
      new Set<string>();

    const sources:
      SourceReference[] = [];

    for (
      const chunk
      of chunks
    ) {

      const key =
        chunk.article !== null
          ? `${chunk.document}-${chunk.article}`
          : chunk.chunkId;

      if (
        seen.has(
          key
        )
      ) {

        continue;
      }

      seen.add(
        key
      );

      sources.push({
        chunkId:
          chunk.chunkId,

        document:
          chunk.document,

        resolution:
          chunk.resolution,

        chapter:
          chunk.chapter,

        section:
          chunk.section,

        article:
          chunk.article,
      });
    }

    return sources;
  }
}