import { SourceReference } from './source-reference.model';

export interface ChatMessage {
  id: string;

  role: 'user' | 'assistant';

  text: string;

  createdAt: Date;

  sources?: SourceReference[];
}