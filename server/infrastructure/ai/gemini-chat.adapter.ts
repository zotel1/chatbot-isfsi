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
  }
}