import {
  ChangeDetectorRef,
  Component,
} from '@angular/core';

import {
  finalize,
} from 'rxjs';

import {
  ChatMessage,
} from '../../models/chat-message.model';

import {
  AvatarState,
} from '../../models/avatar-state.model';

import {
  ChatService,
} from '../../services/chat.service';

import {
  ChatMessage as ChatMessageComponent,
} from '../chat-message/chat-message';

import {
  ChatInput,
} from '../chat-input/chat-input';

import {
  BotAvatar,
} from '../bot-avatar/bot-avatar';

// =====================================================
// COMPONENTE
// =====================================================

@Component({
  selector:
    'app-chatbot-shell',

  standalone:
    true,

  imports: [
    ChatMessageComponent,
    ChatInput,
    BotAvatar,
  ],

  templateUrl:
    './chatbot-shell.html',

  styleUrl:
    './chatbot-shell.css',
})
export class ChatbotShell {

  // ===================================================
  // ESTADO
  // ===================================================

  messages:
    ChatMessage[] = [
      {
        id:
          crypto.randomUUID(),

        role:
          'assistant',

        text:
          'Hola. Soy el Asistente Institucional del ISFD. Puedo ayudarte con consultas sobre el Régimen Académico Marco y otra información institucional autorizada.',

        createdAt:
          new Date(),
      },
    ];

  isLoading =
    false;

  avatarState:
    AvatarState =
      'idle';

  // ===================================================
  // DEPENDENCIAS
  // ===================================================

  constructor(
    private readonly chatService:
      ChatService,

    private readonly changeDetector:
      ChangeDetectorRef
  ) {}

  // ===================================================
  // ENVIAR MENSAJE
  // ===================================================

  handleSendMessage(
    text: string
  ): void {

    const cleanText =
      text.trim();

    if (
      !cleanText ||
      this.isLoading
    ) {

      return;
    }

    // -------------------------------------------------
    // 1. Mensaje del usuario
    // -------------------------------------------------

    const userMessage:
      ChatMessage = {

      id:
        crypto.randomUUID(),

      role:
        'user',

      text:
        cleanText,

      createdAt:
        new Date(),
    };

    this.messages = [
      ...this.messages,
      userMessage,
    ];

    // -------------------------------------------------
    // 2. Estado de carga
    // -------------------------------------------------

    this.isLoading =
      true;

    this.avatarState =
      'thinking';

    /*
     * Estamos usando Angular zoneless.
     *
     * Le avisamos explícitamente a Angular
     * que el estado del componente cambió.
     */
    this.changeDetector
      .markForCheck();

    // -------------------------------------------------
    // 3. Consultar backend
    // -------------------------------------------------

    this.chatService
      .ask(
        cleanText
      )
      .pipe(
        finalize(
          () => {

            this.isLoading =
              false;

            if (
              this.avatarState !==
              'error'
            ) {

              this.avatarState =
                'idle';
            }

            /*
             * Muy importante en modo zoneless:
             * actualizar la interfaz después
             * de finalizar la petición.
             */
            this.changeDetector
              .markForCheck();
          }
        )
      )
      .subscribe({

        // =============================================
        // RESPUESTA CORRECTA
        // =============================================

        next:
          (
            response
          ) => {

            console.log(
              'Respuesta de /api/chat:',
              response
            );

            this.avatarState =
              'replying';

            const assistantMessage:
              ChatMessage = {

              id:
                crypto.randomUUID(),

              role:
                'assistant',

              text:
                response.reply,

              createdAt:
                new Date(),

              sources:
                response.sources,
            };

            this.messages = [
              ...this.messages,
              assistantMessage,
            ];

            /*
             * Avisamos a Angular que hay
             * un nuevo mensaje para mostrar.
             */
            this.changeDetector
              .markForCheck();
          },

        // =============================================
        // ERROR
        // =============================================

        error:
          (
            error
          ) => {

            console.error(
              'Error consultando /api/chat:',
              error
            );

            this.avatarState =
              'error';

            const assistantMessage:
              ChatMessage = {

              id:
                crypto.randomUUID(),

              role:
                'assistant',

              text:
                'No pude procesar la consulta en este momento. Podés intentarlo nuevamente dentro de unos instantes.',

              createdAt:
                new Date(),
            };

            this.messages = [
              ...this.messages,
              assistantMessage,
            ];

            this.changeDetector
              .markForCheck();
          },
      });
  }
}