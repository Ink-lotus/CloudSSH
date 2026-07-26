export interface PickerLayer {
  remove(): void;
}

/** Owns the active picker layer so async render completion cannot revive a replaced picker. */
export class PickerLifecycle {
  private layer: PickerLayer | null = null;
  private disposePicker: (() => void) | null = null;

  activate(layer: PickerLayer): void {
    this.dispose();
    this.layer = layer;
  }

  attach(layer: PickerLayer, disposePicker: () => void): void {
    if (this.layer !== layer) {
      disposePicker();
      return;
    }
    this.disposePicker = disposePicker;
  }

  dismiss(layer: PickerLayer): void {
    if (this.layer === layer) this.dispose();
  }

  dispose(): void {
    this.disposePicker?.();
    this.disposePicker = null;
    this.layer?.remove();
    this.layer = null;
  }
}
