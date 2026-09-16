import {
  GoogleGenAI,
} from '@google/genai';

import {
  ChatModelPort,
} from '../../application/ports/chat-model.port.js';


export class GeminiChatAdapter
implements ChatModelPort {

  private readonly ai:
    GoogleGenAI;


  constructor(
    apiKey: string,

    private readonly model:
      string
  ) {

    this.ai =
      new GoogleGenAI({
        apiKey,
      });
  }


  async generate(
    prompt: string
  ): Promise<string> {

    const maxRetries =
      4;


    for (
      let attempt = 1;
      attempt <= maxRetries;
      attempt++
    ) {

      try {

        const response =
          await this.ai.models
            .generateContent({
              model:
                this.model,

              contents:
                prompt,
            });


        const text =
          response.text;


        if (!text) {

          throw new Error(
            'Gemini no devolvió una respuesta.'
          );
        }


        return text.trim();

      } catch (
        error: unknown
      ) {

        const message =
          error instanceof Error
            ? error.message
            : String(error);


        const temporaryError =
          message.includes('503') ||
          message.includes('429') ||
          message
            .toLowerCase()
            .includes('unavailable') ||
          message
            .toLowerCase()
            .includes('high demand') ||
          message
            .toLowerCase()
            .includes('resource_exhausted');


        if (
          !temporaryError ||
          attempt === maxRetries
        ) {

          throw error;
        }


        const waitTime =
          attempt * 3000;


        console.warn(
          `⚠️ Gemini temporalmente no disponible. Reintento ${attempt}/${maxRetries} en ${waitTime / 1000} segundos...`
        );


        await new Promise(
          (resolve) =>
            setTimeout(
              resolve,
              waitTime
            )
        );
      }
    }


    throw new Error(
      'Gemini no respondió después de varios reintentos.'
    );
  }
}
