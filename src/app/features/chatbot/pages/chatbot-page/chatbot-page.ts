import { Component } from '@angular/core';

import { ChatbotShell } from '../../components/chatbot-shell/chatbot-shell';

@Component({
  selector: 'app-chatbot-page',
  standalone: true,
  imports: [
    ChatbotShell,
  ],
  templateUrl: './chatbot-page.html',
  styleUrl: './chatbot-page.css',
})
export class ChatbotPage {}