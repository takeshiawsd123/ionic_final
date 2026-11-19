import { Component, inject, OnInit } from '@angular/core';
import { IonApp, IonRouterOutlet } from '@ionic/angular';
import { LibraryService } from './services/library.service';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  imports: [IonApp, IonRouterOutlet],
})
export class AppComponent implements OnInit {
  private library = inject(LibraryService);

  ngOnInit(): void {
    setTimeout(() => {
      void this.library.autoScanIfNeeded();
    }, 500);
  }
}
