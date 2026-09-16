import {
  Injectable,
} from '@angular/core';

import {
  HttpClient,
} from '@angular/common/http';

import {
  Observable,
} from 'rxjs';

import {
  SourceReference,
} from '../models/source-reference.model';

// =====================================================
// RESPUESTA DEL BACKEND
// =====================================================

export interface ChatResponse {
  reply: string;

  sources: SourceReference[];
}

// =====================================================
// SERVICIO
// =====================================================

@Injectable({
  providedIn: 'root',
})
export class ChatService {

  private readonly apiUrl =
    '/api/chat';

  constructor(
    private readonly http:
      HttpClient
  ) {}

  ask(
    question: string
  ): Observable<ChatResponse> {

    return this.http.post<ChatResponse>(
      this.apiUrl,
      {
        question,
      }
    );
  }
}