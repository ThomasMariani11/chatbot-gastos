import {
  type CSSProperties,
  type FormEventHandler,
  type MouseEvent,
  type ReactNode,
  useEffect,
  useRef,
} from 'react';

export interface ModalDialogProps {
  open?: boolean;
  onClose: () => void;
  busy?: boolean;
  titleId: string;
  descriptionId?: string;
  backdropClassName?: string;
  className?: string;
  backdropStyle?: CSSProperties;
  style?: CSSProperties;
  as?: 'div' | 'form';
  onSubmit?: FormEventHandler<HTMLFormElement>;
  noValidate?: boolean;
  initialFocusSelector?: string;
  ready?: boolean;
  children: ReactNode;
}

const FOCUSABLE_SELECTOR = [
  'button:not(:disabled)',
  'input:not([type="hidden"]):not(:disabled)',
  'select:not(:disabled)',
  'textarea:not(:disabled)',
  'a[href]',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

const FORM_FIELD_SELECTOR = [
  'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not(:disabled)',
  'select:not(:disabled)',
  'textarea:not(:disabled)',
].join(', ');

let openDialogCount = 0;
let savedBodyOverflow = '';
let savedOutsideTrigger: HTMLElement | null = null;
let savedFallbackTrigger: HTMLElement | null = null;
let lastClickedOutsideElement: HTMLElement | null = null;
let lastClickedFallbackElement: HTMLElement | null = null;

const inertSnapshots = new Map<Element, { ariaHidden: string | null; hadInert: boolean }>();

if (typeof document !== 'undefined') {
  document.addEventListener(
    'click',
    (event) => {
      const rawTarget = event.target instanceof Element ? event.target : null;
      if (!rawTarget) return;
      const interactive = rawTarget.closest<HTMLElement>(
        'button, a[href], [role="button"], [role="menuitem"], [role="tab"], input, select, summary',
      );
      if (interactive && !interactive.closest('[role="dialog"]')) {
        lastClickedOutsideElement = interactive;
        const menuWrap = interactive.closest('.installment-menu-wrap');
        lastClickedFallbackElement =
          menuWrap?.querySelector<HTMLElement>('.installment-menu-trigger') ?? null;
      }
    },
    true,
  );
}

function isElementVisible(el: HTMLElement): boolean {
  if (el.hasAttribute('hidden') || el.closest('[hidden], [aria-hidden="true"]')) {
    return false;
  }
  if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') {
      return false;
    }
  }
  return true;
}

function sortInDocumentOrder<T extends Node>(nodes: T[]): T[] {
  return nodes.sort((a, b) =>
    a === b ? 0 : a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
  );
}

export function getFocusableControls(container: HTMLElement): HTMLElement[] {
  return sortInDocumentOrder(
    Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
      (el) => !el.hasAttribute('disabled') && !el.closest('fieldset:disabled') && isElementVisible(el),
    ),
  );
}

function focusInitialControl(
  dialog: HTMLElement,
  asElement: 'div' | 'form',
  initialFocusSelector?: string,
) {
  if (initialFocusSelector) {
    const customTarget = dialog.querySelector<HTMLElement>(initialFocusSelector);
    if (
      customTarget &&
      !customTarget.hasAttribute('disabled') &&
      !customTarget.closest('fieldset:disabled') &&
      isElementVisible(customTarget)
    ) {
      customTarget.focus();
      return;
    }
  }

  const autoFocusTarget = dialog.querySelector<HTMLElement>(
    '[data-autofocus="true"]:not(:disabled), [autofocus]:not(:disabled)',
  );
  if (
    autoFocusTarget &&
    !autoFocusTarget.closest('fieldset:disabled') &&
    isElementVisible(autoFocusTarget)
  ) {
    autoFocusTarget.focus();
    return;
  }

  if (asElement === 'form') {
    const firstField = sortInDocumentOrder(
      Array.from(dialog.querySelectorAll<HTMLElement>(FORM_FIELD_SELECTOR)).filter(
        (el) => !el.closest('fieldset:disabled') && isElementVisible(el),
      ),
    )[0];
    if (firstField) {
      firstField.focus();
      return;
    }
  }

  const controls = getFocusableControls(dialog);
  const preferredButton = controls.find(
    (el) =>
      !el.classList.contains('modal-close-x') && !el.classList.contains('admin-modal-close'),
  );
  if (preferredButton) {
    preferredButton.focus();
    return;
  }
  if (controls[0]) {
    controls[0].focus();
    return;
  }
  dialog.focus();
}

function applyBackgroundInert(backdropEl: HTMLElement) {
  const parent = backdropEl.parentElement;
  if (!parent) return;

  for (const sibling of Array.from(parent.children)) {
    if (
      sibling === backdropEl ||
      sibling.classList.contains('modal-backdrop') ||
      sibling.classList.contains('admin-modal-backdrop') ||
      sibling.classList.contains('pwa-update-notice') ||
      sibling.querySelector('[role="dialog"]')
    ) {
      continue;
    }
    if (!inertSnapshots.has(sibling)) {
      inertSnapshots.set(sibling, {
        ariaHidden: sibling.getAttribute('aria-hidden'),
        hadInert: sibling.hasAttribute('inert'),
      });
    }
    sibling.setAttribute('aria-hidden', 'true');
    sibling.setAttribute('inert', '');
  }
}

function restoreBackgroundInert() {
  for (const [element, snapshot] of inertSnapshots.entries()) {
    if (snapshot.ariaHidden === null) {
      element.removeAttribute('aria-hidden');
    } else {
      element.setAttribute('aria-hidden', snapshot.ariaHidden);
    }
    if (!snapshot.hadInert) {
      element.removeAttribute('inert');
    }
  }
  inertSnapshots.clear();
}

export function ModalDialog({
  open = true,
  onClose,
  busy = false,
  titleId,
  descriptionId,
  backdropClassName = 'modal-backdrop',
  className = 'movement-form',
  backdropStyle,
  style,
  as = 'div',
  onSubmit,
  noValidate,
  initialFocusSelector,
  ready = true,
  children,
}: ModalDialogProps) {
  const backdropRef = useRef<HTMLDivElement | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const busyRef = useRef(busy);
  const initialFocusSelectorRef = useRef(initialFocusSelector);
  const asRef = useRef(as);

  useEffect(() => {
    onCloseRef.current = onClose;
    busyRef.current = busy;
    initialFocusSelectorRef.current = initialFocusSelector;
    asRef.current = as;
  });

  useEffect(() => {
    if (!open) return;
    const backdrop = backdropRef.current;
    const dialog = dialogRef.current;
    if (!backdrop || !dialog) return;

    if (openDialogCount === 0) {
      savedBodyOverflow = document.body.style.overflow;
      const activeEl =
        document.activeElement instanceof HTMLElement &&
        document.activeElement !== document.body &&
        !document.activeElement.closest('[role="dialog"]')
          ? document.activeElement
          : null;
      savedOutsideTrigger = activeEl ?? lastClickedOutsideElement;
      const menuWrap = savedOutsideTrigger?.closest('.installment-menu-wrap');
      savedFallbackTrigger =
        menuWrap?.querySelector<HTMLElement>('.installment-menu-trigger') ??
        lastClickedFallbackElement;
    }

    openDialogCount += 1;
    document.body.style.overflow = 'hidden';
    applyBackgroundInert(backdrop);
    focusInitialControl(dialog, asRef.current, initialFocusSelectorRef.current);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (!busyRef.current) {
          onCloseRef.current();
        }
        return;
      }

      if (event.key !== 'Tab') return;

      const controls = getFocusableControls(dialog);
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!first || !last) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      if (event.shiftKey) {
        if (!active || !dialog.contains(active) || active === dialog || active === first) {
          event.preventDefault();
          last.focus();
        }
      } else if (!active || !dialog.contains(active) || active === dialog || active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    const handleFocusIn = (event: FocusEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (!target || dialog.contains(target) || target.closest('.pwa-update-notice')) {
        return;
      }
      focusInitialControl(dialog, asRef.current, initialFocusSelectorRef.current);
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('focusin', handleFocusIn);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('focusin', handleFocusIn);
      openDialogCount = Math.max(0, openDialogCount - 1);

      if (openDialogCount === 0) {
        document.body.style.overflow = savedBodyOverflow;
        restoreBackgroundInert();
        const triggerToRestore =
          savedOutsideTrigger && savedOutsideTrigger.isConnected
            ? savedOutsideTrigger
            : savedFallbackTrigger && savedFallbackTrigger.isConnected
              ? savedFallbackTrigger
              : null;
        savedOutsideTrigger = null;
        savedFallbackTrigger = null;
        lastClickedOutsideElement = null;
        lastClickedFallbackElement = null;
        if (triggerToRestore) {
          triggerToRestore.focus();
        }
      }
    };
  }, [open]);

  useEffect(() => {
    if (!open || !ready) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (
      !active ||
      !dialog.contains(active) ||
      active === dialog ||
      active.classList.contains('modal-close-x') ||
      active.classList.contains('admin-modal-close')
    ) {
      focusInitialControl(dialog, as, initialFocusSelector);
    }
  }, [open, ready, as, initialFocusSelector]);

  if (!open) return null;

  const handleBackdropClick = () => {
    if (!busy) {
      onClose();
    }
  };

  const stopPropagation = (event: MouseEvent<HTMLElement>) => {
    event.stopPropagation();
  };

  if (as === 'form') {
    return (
      <div
        ref={backdropRef}
        className={backdropClassName}
        role="presentation"
        style={backdropStyle}
        onClick={handleBackdropClick}
      >
        <form
          ref={(node) => {
            dialogRef.current = node;
          }}
          className={className}
          style={style}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          tabIndex={-1}
          noValidate={noValidate}
          onSubmit={onSubmit}
          onClick={stopPropagation}
          onMouseDown={stopPropagation}
        >
          {children}
        </form>
      </div>
    );
  }

  return (
    <div
      ref={backdropRef}
      className={backdropClassName}
      role="presentation"
      style={backdropStyle}
      onClick={handleBackdropClick}
    >
      <div
        ref={(node) => {
          dialogRef.current = node;
        }}
        className={className}
        style={style}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        onClick={stopPropagation}
        onMouseDown={stopPropagation}
      >
        {children}
      </div>
    </div>
  );
}
