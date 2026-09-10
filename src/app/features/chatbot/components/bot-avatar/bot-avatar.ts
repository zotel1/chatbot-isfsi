import { Component, Input } from '@angular/core';

import { AvatarState } from '../../models/avatar-state.model';

@Component({
  selector: 'app-bot-avatar',
  standalone: true,
  imports: [],
  templateUrl: './bot-avatar.html',
  styleUrl: './bot-avatar.css',
})
export class BotAvatar {
  @Input() state: AvatarState = 'idle';
}