import { afterEach, describe, expect, it, vi } from 'vitest';
import { uploadInspectionPhoto } from '../src/services/api';

class TestXHR {
  static last: TestXHR;
  upload = { onprogress: null as any };
  onload: any;
  onerror: any;
  onabort: any;
  status = 200;
  responseText = '';
  url = '';
  body: any;
  headers: Record<string, string> = {};
  constructor() { TestXHR.last = this; }
  open(_method: string, url: string) { this.url = url; }
  setRequestHeader(name: string, value: string) { this.headers[name] = value; }
  send(body: any) { this.body = body; }
}
afterEach(() => vi.unstubAllGlobals());
describe('Original-photo upload progress', () => {
  it('sends the original File, reports actual transfer progress, and waits for R2 acknowledgement', async () => {
    vi.stubGlobal('XMLHttpRequest', TestXHR);
    const file = new File([new Uint8Array([0, 255, 20])], '原图.png', { type: 'image/png' });
    const progress = vi.fn();
    const promise = uploadInspectionPhoto(file, 'H1', '109-028-1', progress);
    const xhr = TestXHR.last;
    expect(xhr.body).toBe(file);
    expect(xhr.headers['Content-Type']).toBe('image/png');
    expect(new URL(xhr.url, 'http://local').searchParams.get('filename')).toBe('原图.png');
    xhr.upload.onprogress({ lengthComputable: true, loaded: 65, total: 100 });
    expect(progress).toHaveBeenLastCalledWith(65);
    let saved = false;
    void promise.then(() => { saved = true; });
    xhr.upload.onprogress({ lengthComputable: true, loaded: 100, total: 100 });
    await Promise.resolve();
    expect(saved).toBe(false);
    xhr.responseText = JSON.stringify({ success: true, photoId: 'p1' });
    xhr.onload();
    await expect(promise).resolves.toMatchObject({ photoId: 'p1' });
  });
  it('rejects server-side storage failures so the page can retry', async () => {
    vi.stubGlobal('XMLHttpRequest', TestXHR);
    const promise = uploadInspectionPhoto(new File(['original'], 'photo.jpg'), 'H1', '109-028-1');
    TestXHR.last.status = 500;
    TestXHR.last.responseText = JSON.stringify({ success: false, error: 'R2 failed' });
    TestXHR.last.onload();
    await expect(promise).rejects.toThrow('R2 failed');
  });
  it('rejects network failures without changing the original File', async () => {
    vi.stubGlobal('XMLHttpRequest', TestXHR);
    const file = new File(['original'], 'photo.jpg');
    const promise = uploadInspectionPhoto(file, 'H1', '109-028-1');
    TestXHR.last.onerror();
    await expect(promise).rejects.toThrow('请重试');
    expect(TestXHR.last.body).toBe(file);
  });
});
