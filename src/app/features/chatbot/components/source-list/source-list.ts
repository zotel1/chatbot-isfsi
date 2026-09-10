import { Component, Input } from '@angular/core';

import { SourceReference } from '../../models/source-reference.model';

@Component({
  selector: 'app-source-list',
  standalone: true,
  imports: [],
  templateUrl: './source-list.html',
  styleUrl: './source-list.css',
})
export class SourceList {
  @Input() sources: SourceReference[] = [];
}