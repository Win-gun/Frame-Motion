import { spawn } from 'node:child_process';

/** macOS ImageIO/AppKit fallback; the original bytes travel only through stdin. */
export async function convertHeicInMemory(input: Buffer): Promise<Buffer> {
  if (process.platform !== 'darwin') throw new Error('HEIC decoder unavailable on this platform');
  const script = `ObjC.import('Foundation'); ObjC.import('AppKit');
const bytes=$.NSData.alloc.initWithBase64EncodedStringOptions($('${input.toString('base64')}'),0);
const image=$.NSImage.alloc.initWithData(bytes);
if (!image) throw new Error('ImageIO could not decode HEIC');
const tiff=image.TIFFRepresentation;
const bitmap=$.NSBitmapImageRep.alloc.initWithData(tiff);
if (!bitmap) throw new Error('ImageIO could not create bitmap');
const jpeg=bitmap.representationUsingTypeProperties($.NSBitmapImageFileTypeJPEG,$({NSImageCompressionFactor:0.94}));
if (!jpeg) throw new Error('ImageIO could not encode JPEG');
ObjC.unwrap(jpeg.base64EncodedStringWithOptions(0));`;
  return new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/osascript', ['-l', 'JavaScript', '-'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const chunks: Buffer[] = [];
    let length = 0;
    const timer = setTimeout(() => child.kill('SIGKILL'), 60_000);
    child.stdout.on('data', (chunk: Buffer) => {
      length += chunk.length;
      if (length > 150 * 1024 * 1024) child.kill('SIGKILL');
      else chunks.push(chunk);
    });
    child.stderr.resume();
    child.stdin.on('error', reject);
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error('macOS HEIC conversion failed'));
      const result = Buffer.from(Buffer.concat(chunks).toString('utf8').trim(), 'base64');
      if (!result.length) return reject(new Error('macOS HEIC decoder returned no image'));
      resolve(result);
    });
    child.stdin.end(script);
  });
}
