import { Env } from '../types';

export async function handleR2Test(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  if (!env.PHOTO_BUCKET) {
    return Response.json(
      { success: false, error: 'PHOTO_BUCKET R2 binding is not configured in environment.' },
      { status: 500 }
    );
  }

  // GET /api/r2-test?key=xxx -> Download private file
  // GET /api/r2-test -> List test files
  if (request.method === 'GET') {
    const key = url.searchParams.get('key');

    if (key) {
      try {
        const object = await env.PHOTO_BUCKET.get(key);
        if (!object) {
          return Response.json({ success: false, error: `Object '${key}' not found in R2.` }, { status: 404 });
        }

        const headers = new Headers();
        object.writeHttpMetadata(headers);
        headers.set('etag', object.httpEtag);
        headers.set('Cache-Control', 'private, max-age=3600');

        return new Response(object.body, { headers });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return Response.json({ success: false, error: message }, { status: 500 });
      }
    }

    // List objects
    try {
      const list = await env.PHOTO_BUCKET.list({ prefix: 'phase0-test/' });
      const objects = list.objects.map((obj) => ({
        key: obj.key,
        size: obj.size,
        uploaded: obj.uploaded.toISOString(),
        etag: obj.httpEtag,
      }));

      return Response.json({
        success: true,
        count: objects.length,
        objects,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return Response.json({ success: false, error: message }, { status: 500 });
    }
  }

  // POST /api/r2-test -> Upload test photo / file
  if (request.method === 'POST') {
    try {
      const contentType = request.headers.get('content-type') || '';
      let fileBuffer: ArrayBuffer;
      let mimeType = 'application/octet-stream';
      let originalName = 'test-file.bin';

      if (contentType.includes('multipart/form-data')) {
        const formData = await request.formData();
        const file = formData.get('file');
        if (!file || typeof file === 'string' || typeof (file as Blob).arrayBuffer !== 'function') {
          return Response.json({ success: false, error: 'No valid file found in multipart form-data.' }, { status: 400 });
        }
        const fileObj = file as unknown as File;
        fileBuffer = await fileObj.arrayBuffer();
        mimeType = fileObj.type || 'image/jpeg';
        originalName = fileObj.name || 'uploaded_photo.jpg';
      } else {
        // Direct binary or JSON base64
        fileBuffer = await request.arrayBuffer();
        mimeType = contentType || 'image/jpeg';
      }

      if (fileBuffer.byteLength === 0) {
        return Response.json({ success: false, error: 'File content cannot be empty (0 bytes).' }, { status: 400 });
      }

      const timestamp = Date.now();
      const sanitizedName = originalName.replace(/[^a-zA-Z0-9.-]/g, '_');
      const key = `phase0-test/${timestamp}-${sanitizedName}`;

      const putResult = await env.PHOTO_BUCKET.put(key, fileBuffer, {
        httpMetadata: {
          contentType: mimeType,
        },
        customMetadata: {
          uploadedAt: new Date().toISOString(),
          originalName,
        },
      });

      return Response.json({
        success: true,
        message: 'R2 upload successful.',
        file: {
          key: putResult.key,
          size: fileBuffer.byteLength,
          mimeType,
          etag: putResult.httpEtag,
        },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return Response.json({ success: false, error: message }, { status: 500 });
    }
  }

  // DELETE /api/r2-test?key=xxx
  if (request.method === 'DELETE') {
    const key = url.searchParams.get('key');
    if (!key) {
      return Response.json({ success: false, error: 'key query param required.' }, { status: 400 });
    }

    try {
      await env.PHOTO_BUCKET.delete(key);
      return Response.json({ success: true, message: `Deleted ${key} from R2.` });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return Response.json({ success: false, error: message }, { status: 500 });
    }
  }

  return Response.json({ success: false, error: 'Method not allowed' }, { status: 405 });
}
