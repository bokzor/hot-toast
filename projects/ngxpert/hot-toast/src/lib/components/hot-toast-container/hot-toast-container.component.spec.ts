import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { HotToastClose } from '../../hot-toast.model';
import { provideHotToastConfig } from '../../hot-toast.provide';
import { HotToastService } from '../../hot-toast.service';

describe('HotToastContainerComponent before its first render', () => {
  let toast: HotToastService;

  const renderedMessages = () =>
    Array.from(document.querySelectorAll('hot-toast .hot-toast-message')).map((el) => el.textContent?.trim());

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHotToastConfig({ visibleToasts: 2 })] });
    toast = TestBed.inject(HotToastService);
  });

  afterEach(() => document.querySelectorAll('hot-toast-container').forEach((el) => el.remove()));

  it('does not throw when more toasts than visibleToasts are shown in one tick', () => {
    expect(() => {
      toast.show('one');
      toast.show('two');
      toast.show('three');
    }).not.toThrow();
  });

  it('drops the overflowed toast instead of rendering it past visibleToasts', () => {
    const first = toast.show('one');
    const closed: HotToastClose[] = [];
    first.afterClosed.subscribe((event) => closed.push(event));

    toast.show('two');
    toast.show('three');
    TestBed.inject(ApplicationRef).tick();

    expect(closed)
      .withContext('afterClosed of the dropped toast')
      .toEqual([{ dismissedByAction: true, id: first.getToast().id }]);
    expect(renderedMessages()).withContext('rendered toasts').toEqual(['two', 'three']);
  });

  it('leaves group children in the overflow alone', () => {
    const parent = toast.show('parent');
    const child = toast.show('child', { group: { parent } });
    const closedIds: string[] = [];
    parent.afterClosed.subscribe((event) => closedIds.push(event.id));
    child.afterClosed.subscribe((event) => closedIds.push(event.id));

    toast.show('three');
    toast.show('four');
    TestBed.inject(ApplicationRef).tick();

    expect(closedIds).withContext('closed toast ids').toEqual([parent.getToast().id]);
    expect(renderedMessages()).withContext('rendered toasts').toEqual(['three', 'four']);
  });
});
