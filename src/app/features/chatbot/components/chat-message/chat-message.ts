import {
  Component,
  Input,
} from '@angular/core';

import {
  marked,
} from 'marked';

import {
  ChatMessage as ChatMessageModel,
} from '../../models/chat-message.model';

import {
  BotAvatar,
} from '../bot-avatar/bot-avatar';

import {
  SourceList,
} from '../source-list/source-list';

@Component({
  selector: 'app-chat-message',

  standalone: true,

  imports: [
    BotAvatar,
    SourceList,
  ],

  templateUrl: './chat-message.html',

  styleUrl: './chat-message.css',
})
export class ChatMessage {

  @Input({ required: true })
  message!: ChatMessageModel;

  get renderedText(): string {

    return marked.parse(
      this.message.text
    ) as string;
  }
}