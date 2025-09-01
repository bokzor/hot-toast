import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  DoCheck,
  ElementRef,
  EventEmitter,
  inject,
  Injector,
  Input,
  NgZone,
  OnChanges,
  OnDestroy,
  OnInit,
  Output,
  Renderer2,
  signal,
  SimpleChanges,
  ViewChild,
} from '@angular/core';
import { DynamicViewDirective, isComponent, isTemplateRef } from '@ngneat/overview';

import { ENTER_ANIMATION_DURATION, EXIT_ANIMATION_DURATION, HOT_TOAST_DEPTH_SCALE } from '../../constants';
import { HotToastRef } from '../../hot-toast-ref';
import { CreateHotToastRef, HotToastClose, HotToastGroupEvent, Toast, ToastConfig } from '../../hot-toast.model';
import { animate } from '../../utils';
import { IndicatorComponent } from '../indicator/indicator.component';
import { AnimatedIconComponent } from '../animated-icon/animated-icon.component';
import { HotToastGroupItemComponent } from '../hot-toast-group-item/hot-toast-group-item.component';

@Component({
  selector: 'hot-toast',
  templateUrl: 'hot-toast.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DynamicViewDirective, IndicatorComponent, AnimatedIconComponent, HotToastGroupItemComponent],
})
export class HotToastComponent implements OnInit, AfterViewInit, OnDestroy, OnChanges, DoCheck {
  private _toast: Toast<unknown>;
  @Input()
  set toast(value: Toast<unknown>) {
    this._toast = value;
    const ogStyle = this.toastBarBaseStylesSignal();
    const newStyle: Record<string, string> = { ...value.style };

    if (ogStyle['animation']?.includes('hotToastExitAnimation')) {
      // if toast is set for exit, we don't need want set the enter animation
      newStyle['animation'] = ogStyle['animation'];
    } else {
      const top = value.position.includes('top');
      const enterAnimation = `hotToastEnterAnimation${
        top ? 'Negative' : 'Positive'
      } ${ENTER_ANIMATION_DURATION}ms cubic-bezier(0.21, 1.02, 0.73, 1) forwards`;
      newStyle['animation'] = enterAnimation;
    }

    this.toastBarBaseStylesSignal.set(newStyle);
  }
  get toast() {
    return this._toast;
  }
  @Input() offset = 0;
  @Input() defaultConfig: ToastConfig;
  @Input() toastRef: CreateHotToastRef<unknown>;

  private _toastsAfter = 0;
  get toastsAfter() {
    return this._toastsAfter;
  }
  @Input()
  set toastsAfter(value) {
    this._toastsAfter = value;
    if (this.defaultConfig?.visibleToasts > 0) {
      if (this.toast.autoClose) {
        // if (value >= this.defaultConfig?.visibleToasts) {
        //   this.close();
        // }
      } else {
        if (value >= this.defaultConfig?.visibleToasts) {
          this.softClose();
        } else if (this.softClosed) {
          this.softOpen();
        }
      }
    }
  }

  @Input() isShowingAllToasts = false;

  @Output() height = new EventEmitter<number>();
  @Output() beforeClosed = new EventEmitter();
  @Output() afterClosed = new EventEmitter<HotToastClose>();
  @Output() showAllToasts = new EventEmitter<boolean>();
  @Output() toggleGroup = new EventEmitter<HotToastGroupEvent>();

  @ViewChild('hotToastBarBase', { static: true }) private toastBarBase: ElementRef<HTMLElement>;

  isManualClose = false;
  context: Record<string, unknown>;
  toastComponentInjector: Injector;
  isExpanded = false;
  toastBarBaseStylesSignal = signal<Record<string, string>>({});

  private unlisteners: VoidFunction[] = [];
  private softClosed = false;
  private groupRefs: CreateHotToastRef<unknown>[] = [];

  private injector = inject(Injector);
  private renderer = inject(Renderer2);
  private ngZone = inject(NgZone);
  private cdr = inject(ChangeDetectorRef);

  get toastBarBaseHeight() {
    return this.toastBarBase.nativeElement.offsetHeight;
  }

  get scale() {
    return this.defaultConfig.stacking !== 'vertical' && !this.isShowingAllToasts
      ? this.toastsAfter * -HOT_TOAST_DEPTH_SCALE + 1
      : 1;
  }

  get translateY() {
    return this.offset * (this.top ? 1 : -1) + 'px';
  }

  get exitAnimationDelay() {
    return this.toast.duration + 'ms';
  }

  get top() {
    return this.toast.position.includes('top');
  }

  get containerPositionStyle() {
    const verticalStyle = this.top ? { top: 0 } : { bottom: 0 };
    const transform = `translateY(var(--hot-toast-translate-y)) scale(var(--hot-toast-scale))`;

    const horizontalStyle = this.toast.position.includes('left')
      ? {
          left: 0,
        }
      : this.toast.position.includes('right')
      ? {
          right: 0,
        }
      : {
          left: 0,
          right: 0,
          justifyContent: 'center',
        };
    return {
      transform,
      ...verticalStyle,
      ...horizontalStyle,
    };
  }

  get isIconString() {
    return typeof this.toast.icon === 'string';
  }

  get groupChildrenToastRefs() {
    return this.groupRefs.filter((ref) => !!ref);
  }
  set groupChildrenToastRefs(value: CreateHotToastRef<unknown>[]) {
    this.groupRefs = value;

    (this.toastRef as { groupRefs: CreateHotToastRef<unknown>[] }).groupRefs = value;
  }

  get groupChildrenToasts() {
    return this.groupChildrenToastRefs.map((ref) => ref.getToast());
  }

  get groupHeight() {
    return this.visibleToasts
      .slice(-this.defaultConfig.visibleToasts)
      .map((t) => t.height)
      .reduce((prev, curr) => prev + curr, 0);
  }

  get visibleToasts() {
    return this.groupChildrenToasts.filter((t) => t.visible);
  }

  ngDoCheck() {
    if (this.toastRef.groupRefs.length !== this.groupRefs.length) {
      this.groupRefs = this.toastRef.groupRefs.slice();
      this.cdr.markForCheck();

      this.emiHeightWithGroup(this.isExpanded);
    }
    if (this.toastRef.groupExpanded !== this.isExpanded) {
      this.isExpanded = this.toastRef.groupExpanded;
      this.cdr.markForCheck();

      this.emiHeightWithGroup(this.isExpanded);
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes.toast && !changes.toast.firstChange && changes.toast.currentValue?.message) {
      this, this.emiHeightWithGroup(this.isExpanded);
    }
  }

  ngOnInit() {
    if (isTemplateRef(this.toast.message)) {
      this.context = { $implicit: this.toastRef };
    }
    if (isComponent(this.toast.message)) {
      this.toastComponentInjector = Injector.create({
        providers: [
          {
            provide: HotToastRef,
            useValue: this.toastRef,
          },
        ],
        parent: this.toast.injector || this.injector,
      });
    }

    const nativeElement = this.toastBarBase.nativeElement;
    // Caretaker note: `animationstart` and `animationend` events are event tasks that trigger change detection.
    // We'd want to trigger the change detection only if it's an exit animation.
    this.ngZone.runOutsideAngular(() => {
      this.unlisteners.push(
        // Caretaker note: we have to remove these event listeners at the end (even if the element is removed from DOM).
        // zone.js stores its `ZoneTask`s within the `nativeElement[Zone.__symbol__('animationstart') + 'false']` property
        // with callback that capture `this`.
        this.renderer.listen(nativeElement, 'animationstart', (event: AnimationEvent) => {
          if (this.isExitAnimation(event)) {
            this.ngZone.run(() => {
              this.renderer.setStyle(nativeElement, 'pointer-events', 'none');
              this.renderer.setStyle(nativeElement.parentElement, 'pointer-events', 'none');
              this.beforeClosed.emit();
            });
          }
        }),
        this.renderer.listen(nativeElement, 'animationend', (event: AnimationEvent) => {
          if (this.isEnterAnimation(event)) {
            this.ngZone.run(() => {
              if (this.toast.autoClose) {
                const exitAnimation = `hotToastExitAnimation${
                  this.top ? 'Negative' : 'Positive'
                } ${EXIT_ANIMATION_DURATION}ms forwards cubic-bezier(0.06, 0.71, 0.55, 1) var(--hot-toast-exit-animation-delay) var(--hot-toast-exit-animation-state)`;
                this.toastBarBaseStylesSignal.set({ ...this.toast.style, animation: exitAnimation });
              }
            });
          }
          if (this.isExitAnimation(event)) {
            this.ngZone.run(() => this.afterClosed.emit({ dismissedByAction: this.isManualClose, id: this.toast.id }));
          }
        })
      );
    });
  }

  ngAfterViewInit() {
    const nativeElement = this.toastBarBase.nativeElement;
    // Caretaker note: accessing `offsetHeight` triggers the whole layout update.
    // Macro tasks (like `setTimeout`) might be executed within the current rendering frame and cause a frame drop.
    requestAnimationFrame(() => {
      this.height.emit(nativeElement.offsetHeight);
    });

    this.setToastAttributes();
    this.attachSwipeListeners();
  }

  // Swipe-to-dismiss implementation (vertical: bottom -> top)
  private drag = {
    active: false,
    locked: false,
    startX: 0,
    startY: 0,
    lastY: 0,
    lastT: 0,
    vy: 0,
    dy: 0,
  };

  private rubberband(x: number) {
    const a = 0.55;
    const ax = Math.abs(x);
    const eased = 1 - Math.pow(1 - Math.min(1, ax), a);
    return Math.sign(x) * eased;
  }

  private decideVerticalDismiss(el: HTMLElement, dy: number, vy: number) {
    const height = el.offsetHeight || 1;
    const distanceDismiss = dy < 0 && Math.abs(dy) > height * 0.35; // upward only
    const velocityDismiss = vy < 0 && Math.abs(vy) > 800; // px/s upward
    return distanceDismiss || velocityDismiss;
  }

  private attachSwipeListeners() {
    const el = this.toastBarBase.nativeElement;
    this.ngZone.runOutsideAngular(() => {
      const downUn = this.renderer.listen(el, 'pointerdown', (e: PointerEvent) => {
        if ((e as any).button !== undefined && (e as any).button !== 0) return;
        this.drag.active = true;
        this.drag.locked = false;
        this.drag.startX = e.clientX;
        this.drag.startY = e.clientY;
        this.drag.lastY = e.clientY;
        this.drag.lastT = performance.now();
        (el as any).setPointerCapture?.((e as any).pointerId);
        this.ngZone.run(() => this.showAllToasts.emit(true));
        this.renderer.setStyle(el, 'will-change', 'transform, opacity');
        this.renderer.setStyle(el, 'touch-action', 'pan-x');
        this.renderer.setStyle(el, 'cursor', 'grabbing');
      });

      const moveUn = this.renderer.listen(el, 'pointermove', (e: PointerEvent) => {
        if (!this.drag.active) return;
        const dxRaw = e.clientX - this.drag.startX;
        const dyRaw = e.clientY - this.drag.startY;
        if (!this.drag.locked) {
          const slop = 8;
          if (Math.abs(dxRaw) < slop && Math.abs(dyRaw) < slop) return;
          if (Math.abs(dyRaw) > Math.abs(dxRaw) && dyRaw < 0) {
            this.drag.locked = true; // commit to upward vertical gesture
          } else {
            cancelDrag();
            return;
          }
        }
        const height = el.offsetHeight || 1;
        const eased = this.rubberband(dyRaw / height) * height;
        this.drag.dy = eased;
        const opacity = 1 - Math.min(1, Math.abs(eased) / height);
        this.renderer.setStyle(el, 'transform', `translate3d(0,${eased}px,0)`);
        this.renderer.setStyle(el, 'opacity', String(opacity));
        const now = performance.now();
        const dt = Math.max(1, now - this.drag.lastT);
        this.drag.vy = ((e.clientY - this.drag.lastY) / dt) * 1000;
        this.drag.lastY = e.clientY;
        this.drag.lastT = now;
      });

      const upHandler = () => {
        if (!this.drag.active) return;
        const shouldDismiss = this.decideVerticalDismiss(el, this.drag.dy, this.drag.vy);
        if (shouldDismiss) {
          const height = el.offsetHeight || 1;
          const target = -1 * (window.innerHeight + height); // always upward
          const current = getComputedStyle(el);
          (el as any)
            .animate(
              [
                { transform: `translate3d(0,${this.drag.dy}px,0)`, opacity: Number(current.opacity) || 1 },
                { transform: `translate3d(0,${target}px,0)`, opacity: 0 },
              ],
              { duration: 220, easing: 'cubic-bezier(.22,.61,.36,1)' }
            )
            .finished.finally(() => {
              this.ngZone.run(() => {
                this.beforeClosed.emit();
                this.afterClosed.emit({ dismissedByAction: true, id: this.toast.id });
              });
              (navigator as any).vibrate?.(10);
            });
        } else {
          const current = getComputedStyle(el);
          (el as any)
            .animate(
              [
                { transform: current.transform, opacity: Number(current.opacity) },
                { transform: 'translate3d(0,0,0)', opacity: 1 },
              ],
              { duration: 240, easing: 'cubic-bezier(.17,.89,.32,1.27)' }
            )
            .finished.finally(() => {
              this.renderer.removeStyle(el, 'transform');
              this.renderer.removeStyle(el, 'opacity');
              this.ngZone.run(() => this.showAllToasts.emit(false));
            });
        }
        finishDrag();
      };

      const upUn = this.renderer.listen(el, 'pointerup', upHandler);
      const cancelUn = this.renderer.listen(el, 'pointercancel', upHandler);

      const cancelDrag = () => {
        this.drag.active = false;
        this.drag.locked = false;
        this.ngZone.run(() => this.showAllToasts.emit(false));
        this.renderer.removeStyle(el, 'cursor');
        this.renderer.removeStyle(el, 'will-change');
      };

      const finishDrag = () => {
        this.drag.active = false;
        this.drag.locked = false;
        this.drag.dy = 0;
        this.drag.vy = 0;
        this.renderer.removeStyle(el, 'cursor');
        this.renderer.removeStyle(el, 'will-change');
      };

      this.unlisteners.push(downUn, moveUn, upUn, cancelUn);
    });
  }

  softClose() {
    const exitAnimation = `hotToastExitSoftAnimation${
      this.top ? 'Negative' : 'Positive'
    } ${EXIT_ANIMATION_DURATION}ms forwards cubic-bezier(0.06, 0.71, 0.55, 1)`;

    const nativeElement = this.toastBarBase.nativeElement;

    animate(this.renderer, nativeElement, exitAnimation);
    this.softClosed = true;

    if (this.isExpanded) {
      this.toggleToastGroup();
    }
  }

  softOpen() {
    const softEnterAnimation = `hotToastEnterSoftAnimation${
      top ? 'Negative' : 'Positive'
    } ${ENTER_ANIMATION_DURATION}ms cubic-bezier(0.21, 1.02, 0.73, 1) forwards`;

    const nativeElement = this.toastBarBase.nativeElement;

    animate(this.renderer, nativeElement, softEnterAnimation);
    this.softClosed = false;
  }

  close() {
    this.isManualClose = true;
    this.cdr.markForCheck();

    const exitAnimation = `hotToastExitAnimation${
      this.top ? 'Negative' : 'Positive'
    } ${EXIT_ANIMATION_DURATION}ms forwards cubic-bezier(0.06, 0.71, 0.55, 1)`;

    this.toastBarBaseStylesSignal.set({ ...this.toast.style, animation: exitAnimation });
  }

  handleMouseEnter() {
    this.showAllToasts.emit(true);
  }
  handleMouseLeave() {
    this.showAllToasts.emit(false);
  }

  ngOnDestroy() {
    this.close();
    while (this.unlisteners.length) {
      this.unlisteners.pop()();
    }
  }

  private isExitAnimation(ev: AnimationEvent) {
    return ev.animationName.includes('hotToastExitAnimation');
  }

  private isEnterAnimation(ev: AnimationEvent) {
    return ev.animationName.includes('hotToastEnterAnimation');
  }

  private setToastAttributes() {
    const toastAttributes: Record<string, string> = this.toast.attributes;
    for (const [key, value] of Object.entries(toastAttributes)) {
      this.renderer.setAttribute(this.toastBarBase.nativeElement, key, value);
    }
  }

  calculateOffset(toastId: string) {
    const visibleToasts = this.visibleToasts;
    const index = visibleToasts.findIndex((toast) => toast.id === toastId);
    const offset =
      index !== -1
        ? visibleToasts.slice(...(this.defaultConfig.reverseOrder ? [index + 1] : [0, index])).reduce((acc, t, i) => {
            return this.defaultConfig.visibleToasts !== 0 && i < visibleToasts.length - this.defaultConfig.visibleToasts
              ? 0
              : acc + (t.height || 0);
          }, 0)
        : 0;
    return offset;
  }

  updateHeight(height: number, toast: Toast<unknown>) {
    toast.height = height;
    this.cdr.markForCheck();
  }

  beforeClosedGroupItem(toast: Toast<unknown>) {
    toast.visible = false;
    this.cdr.markForCheck();
    if (this.visibleToasts.length === 0 && this.isExpanded) {
      this.toggleToastGroup();
    } else {
      this.emiHeightWithGroup(this.isExpanded);
    }
  }

  afterClosedGroupItem(closeToast: HotToastClose) {
    const toastIndex = this.groupChildrenToasts.findIndex((t) => t.id === closeToast.id);
    if (toastIndex > -1) {
      this.groupChildrenToastRefs = this.groupChildrenToastRefs.filter((t) => t.getToast().id !== closeToast.id);
      this.cdr.markForCheck();
    }
  }

  toggleToastGroup() {
    const event = this.isExpanded ? 'collapse' : 'expand';
    this.toggleGroup.emit({
      byAction: true,
      event,
      id: this.toast.id,
    });
    this.emiHeightWithGroup(event === 'expand');
  }

  private emiHeightWithGroup(isExpanded: boolean) {
    if (isExpanded) {
      requestAnimationFrame(() => {
        this.height.emit(this.toastBarBase.nativeElement.offsetHeight + this.groupHeight);
      });
    } else {
      requestAnimationFrame(() => {
        this.height.emit(this.toastBarBase.nativeElement.offsetHeight);
      });
    }
  }
}
