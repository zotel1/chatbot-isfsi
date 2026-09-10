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
// RESULTADO PROCESADO DEL MODELO
// =====================================================

interface ParsedModelResponse {
  reply: string;

  usedSourceIndexes: number[];
}

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
    // 1. Generar embedding de la pregunta
    // -------------------------------------------------

    const queryVector =
      await this.embeddingGenerator
        .generate(
          cleanQuestion
        );

    // -------------------------------------------------
    // 2. Recuperar conocimiento desde Qdrant
    // -------------------------------------------------

    const chunks =
      await this.vectorSearch
        .search(
          queryVector,
          DEFAULT_TOP_K
        );

    // -------------------------------------------------
    // 3. Si no existe contexto suficiente
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
    // 4. Construir prompt RAG
    // -------------------------------------------------

    const prompt =
      this.buildPrompt(
        cleanQuestion,
        chunks
      );

    // -------------------------------------------------
    // 5. Generar respuesta
    // -------------------------------------------------

    const rawResponse =
      await this.chatModel
        .generate(
          prompt
        );

    // -------------------------------------------------
    // 6. Interpretar qué fuentes utilizó Gemini
    // -------------------------------------------------

    const parsedResponse =
      this.parseModelResponse(
        rawResponse,
        chunks.length
      );

    // -------------------------------------------------
    // 7. Seleccionar únicamente fuentes utilizadas
    // -------------------------------------------------

    const usedChunks =
      parsedResponse
        .usedSourceIndexes
        .map(
          (index) =>
            chunks[index]
        )
        .filter(
          (
            chunk
          ): chunk is KnowledgeChunk =>
            chunk !== undefined
        );

    // -------------------------------------------------
    // 8. Fallback de seguridad
    // -------------------------------------------------

    /*
     * Si por algún motivo Gemini no devolvió
     * FUENTES_USADAS correctamente, no dejamos
     * al usuario sin referencias.
     *
     * Intentamos detectar artículos mencionados
     * dentro de la propia respuesta.
     */
    const finalChunks =
      usedChunks.length > 0
        ? usedChunks
        : this.findSourcesFromReply(
            parsedResponse.reply,
            chunks
          );

    // -------------------------------------------------
    // 9. Construir referencias para Angular
    // -------------------------------------------------

    const sources =
      this.buildSources(
        finalChunks
      );

    return {
      reply:
        parsedResponse.reply,

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

            const sourceLabel =
              `S${index + 1}`;

            const source =
              this.formatSource(
                chunk
              );

            return [
              `[${sourceLabel}]`,
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

3. Diferenciá claramente cuando una regla depende de una condición específica.

4. Si las fuentes no contienen información suficiente para responder, indicá claramente que no contás con información suficiente en las fuentes disponibles.

5. Si la consulta depende de una situación académica personal que no puede resolverse únicamente con la normativa recuperada, orientá al estudiante a consultar con el área o autoridad institucional correspondiente.

6. Respondé en español claro y comprensible.

7. Evitá lenguaje jurídico innecesariamente complejo, pero no alteres el significado de la normativa.

8. No afirmes que una decisión institucional fue tomada si las fuentes no lo indican.

9. Cuando corresponda, mencioná el número del artículo que sustenta la respuesta.

10. No inventes artículos ni referencias.

11. Cada fuente recuperada está identificada como S1, S2, S3, etc.

12. Utilizá solamente las fuentes necesarias para responder la consulta.

13. Al finalizar tu respuesta agregá, EN UNA ÚNICA LÍNEA y sin explicaciones adicionales:

FUENTES_USADAS: S1,S2

Reemplazá S1,S2 por las fuentes que realmente utilizaste.

Si utilizaste solamente una:

FUENTES_USADAS: S1

No incluyas una fuente solamente porque fue recuperada. Incluila únicamente si su contenido fue utilizado para construir la respuesta.

PREGUNTA DEL ESTUDIANTE:

${question}

FUENTES RECUPERADAS:

${context}

RESPUESTA:
`.trim();
  }

  // ===================================================
  // INTERPRETAR RESPUESTA DEL MODELO
  // ===================================================

  private parseModelResponse(
    rawResponse: string,
    sourceCount: number
  ): ParsedModelResponse {

    const pattern =
      /FUENTES_USADAS\s*:\s*([^\n\r]+)/i;

    const match =
      rawResponse.match(
        pattern
      );

    // -------------------------------------------------
    // Limpiar metadata interna de la respuesta visible
    // -------------------------------------------------

    const reply =
      rawResponse
        .replace(
          pattern,
          ''
        )
        .trim();

    if (
      !match
    ) {

      return {
        reply,
        usedSourceIndexes: [],
      };
    }

    // -------------------------------------------------
    // Ejemplo:
    //
    // "S1,S2,S4"
    //     ↓
    // [0, 1, 3]
    // -------------------------------------------------

    const usedSourceIndexes =
      match[1]
        .split(
          ','
        )
        .map(
          (value) =>
            value.trim()
        )
        .map(
          (value) => {

            const sourceMatch =
              value.match(
                /^S(\d+)$/i
              );

            if (
              !sourceMatch
            ) {

              return null;
            }

            const sourceNumber =
              Number(
                sourceMatch[1]
              );

            const index =
              sourceNumber - 1;

            if (
              index < 0 ||
              index >= sourceCount
            ) {

              return null;
            }

            return index;
          }
        )
        .filter(
          (
            index
          ): index is number =>
            index !== null
        );

    return {
      reply,

      usedSourceIndexes:
        Array.from(
          new Set(
            usedSourceIndexes
          )
        ),
    };
  }

  // ===================================================
  // FALLBACK: BUSCAR ARTÍCULOS MENCIONADOS
  // ===================================================

  private findSourcesFromReply(
    reply: string,
    chunks: KnowledgeChunk[]
  ): KnowledgeChunk[] {

    const selected:
      KnowledgeChunk[] = [];

    for (
      const chunk
      of chunks
    ) {

      if (
        chunk.article === null
      ) {

        continue;
      }

      const articlePattern =
        new RegExp(
          `art[ií]culo\\s+${chunk.article}\\b`,
          'i'
        );

      if (
        articlePattern.test(
          reply
        )
      ) {

        selected.push(
          chunk
        );
      }
    }

    /*
     * Si tampoco pudimos detectar un artículo,
     * usamos solamente el primer resultado
     * recuperado, en lugar de mostrar los cinco.
     */
    if (
      selected.length === 0 &&
      chunks.length > 0
    ) {

      selected.push(
        chunks[0]
      );
    }

    return selected;
  }

  // ===================================================
  // FORMATEAR FUENTE PARA GEMINI
  // ===================================================

  private formatSource(
    chunk: KnowledgeChunk
  ): string {

    const parts:
      string[] = [
        chunk.document,
        chunk.resolution,
      ];

    if (
      chunk.chapter
    ) {

      parts.push(
        `Capítulo: ${chunk.chapter}`
      );
    }

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