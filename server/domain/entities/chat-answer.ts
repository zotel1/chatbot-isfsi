import {
  SourceReference,
} from './source-reference.js';

export interface ChatAnswer {
  reply: string;

  sources: SourceReference[];
}