import { afterEach, describe, expect, it, vi } from 'vitest';
import { installInteractionPerformanceDiagnostics } from '../interactionPerformanceDiagnostics';

let monitor: ReturnType<typeof installInteractionPerformanceDiagnostics> | undefined;
afterEach(() => { monitor?.stop(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function setup() {
  let now = 10;
  let nextId = 0;
  const callbacks = new Map<number, FrameRequestCallback>();
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callbacks.set(++nextId, callback); return nextId; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id));
  const write = vi.fn();
  const registrations = vi.spyOn(window, 'addEventListener');
  monitor = installInteractionPerformanceDiagnostics(write);
  return {
    write, callbacks,
    setTime: (value: number) => { now = value; },
    draw: (value: number) => {
      now = value;
      const pending = [...callbacks.values()]; callbacks.clear();
      for (const callback of pending) callback(now);
    },
    input: (stamp: number) => {
      const capture = registrations.mock.calls.find(call => call[0] === 'pointerdown')![1] as EventListener;
      capture({ type: 'pointerdown', timeStamp: stamp, isTrusted: true } as Event);
    },
  };
}

describe('interaction performance diagnostics', () => {
  it('counts scroll gaps, limits warning frequency and stops rAF after activity', () => {
    const env = setup();
    window.dispatchEvent(new Event('scroll'));
    env.draw(26); env.draw(42); env.draw(342); env.draw(642);
    expect(monitor!.summary()).toContain('scroll_stalls_ge_100ms=2');
    expect(monitor!.summary()).toContain('max_frame_gap_ms=300');
    expect(monitor!.summary()).toContain('frame_gap_p95_le_ms=500');
    expect(env.write).toHaveBeenCalledTimes(1);
    expect(env.write.mock.calls[0][1]).toContain('kind=scroll_frame_gap');
    env.draw(1600);
    expect(env.callbacks.size).toBe(0);
    monitor!.reset();
    expect(monitor!.summary()).toContain('active_raf_fps=unavailable');
  });

  it('coalesces input callbacks and measures event queue plus next rAF latency', () => {
    const env = setup();
    env.setTime(200);
    env.input(100); env.input(180);
    expect(env.callbacks.size).toBe(1);
    env.draw(450);
    const summary = monitor!.summary();
    expect(summary).toContain('input_events=2');
    expect(summary).toContain('max_input_capture_delay_ms=100');
    expect(summary).toContain('input_next_raf_samples=1');
    expect(summary).toContain('max_input_to_next_raf_ms=350');
    monitor!.pause();
    expect(env.callbacks.size).toBe(0);
    env.setTime(600000); monitor!.resume();
    window.dispatchEvent(new Event('scroll')); env.draw(600016);
    expect(monitor!.summary()).toContain('max_frame_gap_ms=0');
    monitor!.stop();
    window.dispatchEvent(new Event('scroll'));
    expect(env.callbacks.size).toBe(0);
  });

  it('uses Event Timing and long animation entries without logging event targets', () => {
    const observed = new Map<string, PerformanceObserverCallback>();
    vi.stubGlobal('PerformanceObserver', class {
      static supportedEntryTypes = ['event', 'long-animation-frame'];
      callback: PerformanceObserverCallback;
      constructor(callback: PerformanceObserverCallback) { this.callback = callback; }
      observe(options: PerformanceObserverInit) { observed.set(options.type!, this.callback); }
      takeRecords() { return []; }
      disconnect() {}
    });
    const env = setup();
    const send = (type: string, entry: object) => observed.get(type)!({ getEntries: () => [entry] } as PerformanceObserverEntryList, {} as PerformanceObserver);
    send('event', { duration: 240, processingStart: 120, processingEnd: 180, target: 'private target', name: 'private key' });
    send('long-animation-frame', { duration: 300, blockingDuration: 210, scripts: ['private script'] });
    expect(monitor!.summary()).toContain('max_event_to_render_ms=240 max_event_handler_ms=60');
    expect(monitor!.summary()).toContain('animation_blocking_ms=210');
    expect(JSON.stringify(env.write.mock.calls)).not.toContain('private');
    monitor!.reset();
    expect(monitor!.summary()).toContain('timed_events=0');
  });

  it('卡顿日志每三十秒最多一条，只保留本应用脚本文件名和耗时', () => {
    const observed = new Map<string, PerformanceObserverCallback>();
    vi.stubGlobal('PerformanceObserver', class {
      static supportedEntryTypes = ['long-animation-frame'];
      constructor(private callback: PerformanceObserverCallback) {}
      observe(options: PerformanceObserverInit) { observed.set(options.type!, this.callback); }
      takeRecords() { return []; }
      disconnect() {}
    });
    const env = setup();
    const send = (sourceURL: string) => observed.get('long-animation-frame')!({ getEntries: () => [{
      duration: 300, blockingDuration: 200,
      scripts: [{ duration: 240, sourceURL, sourceFunctionName: 'private function', forcedStyleAndLayoutDuration: 90 }],
    }] } as unknown as PerformanceObserverEntryList, {} as PerformanceObserver);
    send(`${window.location.origin}/assets/Home-abc123.js?token=private-token`);
    send('https://private-host.example/private-path?token=private-token');
    expect(env.write).toHaveBeenCalledTimes(1);
    expect(env.write.mock.calls[0][1]).toContain('script_asset=Home-abc123.js');
    expect(env.write.mock.calls[0][1]).toContain('slowest_script_ms=240 forced_layout_ms=90');
    env.setTime(30_010);
    send('https://private-host.example/private-path?token=private-token');
    expect(env.write).toHaveBeenCalledTimes(2);
    expect(env.write.mock.calls[1][1]).toContain('suppressed_events=1');
    expect(env.write.mock.calls[1][1]).toContain('script_asset=unavailable');
    expect(JSON.stringify(env.write.mock.calls)).not.toContain('private');
  });
});
