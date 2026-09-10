import { Component } from '@angular/core';

import { ChatMessage } from '../../models/chat-message.model';

import { ChatMessage as ChatMessageComponent } from '../chat-message/chat-message';
import { ChatInput } from '../chat-input/chat-input';
import { BotAvatar } from '../bot-avatar/bot-avatar';

@Component({
  selector: 'app-chatbot-shell',
  standalone: true,
  imports: [
    ChatMessageComponent,
    ChatInput,
    BotAvatar,
  ],
  templateUrl: './chatbot-shell.html',
  styleUrl: './chatbot-shell.css',
})
export class ChatbotShell {

  messages: ChatMessage[] = [
    {
      id: crypto.randomUUID(),

      role: 'assistant',

      text:
        'Hola. Soy el Asistente Institucional del ISFD. Puedo ayudarte con consultas sobre el Régimen Académico Marco y otra información institucional autorizada.',

      createdAt: new Date(),
    },
  ];

  handleSendMessage(text: string): void {

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),

      role: 'user',

      text,

      createdAt: new Date(),
    };

    this.messages = [
      ...this.messages,
      userMessage,
    ];

    /*
     * Respuesta temporal.
     *
     * En un bloque posterior esta parte
     * llamará a /api/chat.
     */

    setTimeout(() => {

      const assistantMessage: ChatMessage = {
        id: crypto.randomUUID(),

        role: 'assistant',

        text:
          'Todavía estoy funcionando en modo local. En el próximo bloque conectaremos el chatbot con la base de conocimiento institucional.',

        createdAt: new Date(),
      };

      this.messages = [
        ...this.messages,
        assistantMessage,
      ];

    }, 600);
  }
}