import {
  Component,
  EventEmitter,
  Input,
  Output,
} from '@angular/core';

import {
  FormsModule,
} from '@angular/forms';

@Component({
  selector:
    'app-chat-input',

  standalone:
    true,

  imports: [
    FormsModule,
  ],

  templateUrl:
    './chat-input.html',

  styleUrl:
    './chat-input.css',
})
export class ChatInput {

  @Input()
  disabled =
    false;

  @Output()
  sendMessage =
    new EventEmitter<string>();

  message =
    '';

  submitMessage(): void {

    if (
      this.disabled
    ) {

      return;
    }

    const cleanMessage =
      this.message.trim();

    if (
      !cleanMessage
    ) {

      return;
    }

    this.sendMessage.emit(
      cleanMessage
    );

    this.message =
      '';
  }
}