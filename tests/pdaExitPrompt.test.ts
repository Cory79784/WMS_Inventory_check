import { afterEach, describe, expect, it, vi } from 'vitest';
import { confirmPdaExit } from '../src/utils/exitPrompt';
import { registerLanguageSafety } from '../src/i18n/safety';

const cleanup: Array<() => void> = [];
afterEach(() => { while (cleanup.length) cleanup.pop()?.(); });
function guard(dirty: boolean, busy: boolean) {
  cleanup.push(registerLanguageSafety('exit-test', {dirty: () => dirty, busy: () => busy}));
}
describe('PDA system exit safety', () => {
  it('asks for confirmation even with no unsaved changes', () => {
    guard(false, false);
    const ask = vi.fn(() => false);
    expect(confirmPdaExit(ask, vi.fn())).toBe(false);
    expect(ask).toHaveBeenCalledWith(expect.stringContaining('退出库存核查系统'));
    ask.mockReturnValue(true);
    expect(confirmPdaExit(ask, vi.fn())).toBe(true);
  });
  it('warns about unsaved quantities, notes or photo links before exiting', () => {
    guard(true, false);
    const ask = vi.fn(() => false);
    expect(confirmPdaExit(ask, vi.fn())).toBe(false);
    expect(ask).toHaveBeenCalledWith(expect.stringContaining('尚未同步'));
    ask.mockReturnValue(true);
    expect(confirmPdaExit(ask, vi.fn())).toBe(true);
  });
  it('blocks exit during save/upload without accepting a confirmation', () => {
    guard(true, true);
    const ask = vi.fn(() => true);
    const notify = vi.fn();
    expect(confirmPdaExit(ask, notify)).toBe(false);
    expect(ask).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('正在保存或上传'));
  });
});
